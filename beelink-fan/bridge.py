#!/usr/bin/env python3
"""
beelink-fan bridge: hwmon -> MQTT with Home Assistant auto-discovery.

Target: Beelink S12 (Intel N100, ITE IT8613E Super I/O) via the
frankcrawford/it87 out-of-tree hwmon driver.

Reads (all by chip *name*, never by hwmonN index):
  - it8613/it87 chip : temp*_input (+ temp*_label), fan*_input (+ fan*_label),
                       pwm* / pwm*_enable
  - coretemp         : CPU temperatures
  - nvme             : drive temperatures

Publishes state + HA MQTT discovery. Accepts fan control commands:
  - percentage  -> manual mode, pwm duty = pct% of 255
  - preset Auto   -> pwm_enable=2  (chip/EC automatic control)
  - preset Manual -> pwm_enable=1  (keep current duty)
  - preset Quiet  -> pwm_enable=1 with capped duty (QUIET_PWM)
  - trial       -> manual duty for N seconds, then restore previous state
  - restore     -> pwm_enable=2 on all channels ("restore firmware")
"""

import glob
import json
import os
import re
import signal
import threading
import time

import paho.mqtt.client as mqtt

# ------------------------------------------------------------------ config

MQTT_HOST = os.environ.get("MQTT_HOST", "mosquitto")
MQTT_PORT = int(os.environ.get("MQTT_PORT", "1883"))
MQTT_USER = os.environ.get("MQTT_USER", "")
MQTT_PASS = os.environ.get("MQTT_PASS", "")
DEVICE_NAME = os.environ.get("DEVICE_NAME", "beelink-s12")
DISCOVERY_PREFIX = os.environ.get("DISCOVERY_PREFIX", "homeassistant")
SCAN_INTERVAL = float(os.environ.get("SCAN_INTERVAL", "10"))
QUIET_PWM = int(os.environ.get("QUIET_PWM", "64"))  # ~25% of 255
TRIAL_DEFAULT_PERCENT = int(os.environ.get("TRIAL_DEFAULT_PERCENT", "60"))
TRIAL_DEFAULT_SECONDS = int(os.environ.get("TRIAL_DEFAULT_SECONDS", "120"))

BASE = f"{DEVICE_NAME}/fanctl"
STATUS_TOPIC = f"{BASE}/status"
TRIAL_REMAINING_TOPIC = f"{BASE}/trial/remaining"

# hwmon pwm_enable semantics (it87 follows the hwmon spec):
PWM_MANUAL = 1
PWM_AUTO = 2

DEVICE_INFO = {
    "identifiers": [DEVICE_NAME],
    "name": "Beelink S12",
    "manufacturer": "Beelink",
    "model": "S12 (Mini S, IT8613E)",
}

shutdown_requested = threading.Event()


def log(*args):
    print("[bridge]", *args, flush=True)


def read_file(path):
    try:
        with open(path, "r") as fh:
            return fh.read().strip()
    except OSError:
        return None


def read_int(path):
    raw = read_file(path)
    if raw is None:
        return None
    try:
        return int(raw)
    except ValueError:
        return None


def write_file(path, value):
    try:
        with open(path, "w") as fh:
            fh.write(str(value))
        return True
    except OSError as exc:
        log(f"WARN: cannot write {path}={value}: {exc}")
        return False


def slug(text):
    s = re.sub(r"[^a-z0-9]+", "_", text.lower()).strip("_")
    return s or "sensor"


def find_chips(*needles):
    """hwmon dirs whose 'name' contains any needle (case-insensitive)."""
    out = []
    for d in sorted(glob.glob("/sys/class/hwmon/hwmon*")):
        name = read_file(os.path.join(d, "name")) or ""
        if any(n.lower() in name.lower() for n in needles):
            out.append((d, name))
    return out


def numbered_indices(hwmon_dir, prefix, suffix):
    """Indices for files like temp1_input, fan2_input, pwm3, pwm3_enable."""
    idxs = set()
    for path in glob.glob(os.path.join(hwmon_dir, f"{prefix}*")):
        m = re.match(rf"^{re.escape(prefix)}(\d+){re.escape(suffix)}$",
                     os.path.basename(path))
        if m:
            idxs.add(int(m.group(1)))
    return sorted(idxs)


# ---------------------------------------------------------- fan controller

class FanController:
    """Wraps the it8613 hwmon device; all fan/pwm operations go through here."""

    def __init__(self):
        self.hwmon = None
        self.chip_name = None
        self.refresh()

    def refresh(self):
        """(Re)locate the chip by name. Returns True if found."""
        chips = find_chips("it8613", "it87")
        if chips:
            self.hwmon, self.chip_name = chips[0]
        else:
            self.hwmon, self.chip_name = None, None
        return self.hwmon is not None

    @property
    def pwm_channels(self):
        if not self.hwmon:
            return []
        return numbered_indices(self.hwmon, "pwm", "")

    def channel_state(self, idx):
        en = read_int(f"{self.hwmon}/pwm{idx}_enable")
        pwm = read_int(f"{self.hwmon}/pwm{idx}")
        return en, pwm

    def snapshot(self):
        return {i: self.channel_state(i) for i in self.pwm_channels}

    def restore(self, snap):
        for idx, (en, pwm) in snap.items():
            if en is not None:
                write_file(f"{self.hwmon}/pwm{idx}_enable", en)
            if pwm is not None and en == PWM_MANUAL:
                write_file(f"{self.hwmon}/pwm{idx}", pwm)

    def set_auto(self):
        """Return all channels to chip/EC automatic control."""
        for i in self.pwm_channels:
            write_file(f"{self.hwmon}/pwm{i}_enable", PWM_AUTO)

    def set_manual(self, pwm_value):
        """Manual mode on all channels at the given duty (0-255)."""
        pwm_value = max(0, min(255, int(pwm_value)))
        for i in self.pwm_channels:
            write_file(f"{self.hwmon}/pwm{i}_enable", PWM_MANUAL)
            write_file(f"{self.hwmon}/pwm{i}", pwm_value)

    def set_manual_keep_duty(self):
        for i in self.pwm_channels:
            write_file(f"{self.hwmon}/pwm{i}_enable", PWM_MANUAL)

    def primary_state(self):
        chans = self.pwm_channels
        if not chans:
            return None, None
        return self.channel_state(chans[0])

    def current_preset(self):
        en, pwm = self.primary_state()
        if en == PWM_AUTO:
            return "Auto"
        if en == PWM_MANUAL and pwm == QUIET_PWM:
            return "Quiet"
        if en == PWM_MANUAL:
            return "Manual"
        return "Auto"

    def current_percent(self):
        _, pwm = self.primary_state()
        return round((pwm or 0) / 255 * 100)


# ------------------------------------------------------------ trial manager

class TrialManager:
    """2-minute trial: manual duty for N seconds, then restore prior state."""

    def __init__(self, fan):
        self.fan = fan
        self.lock = threading.Lock()
        self.timer = None
        self._stop = threading.Event()
        self.remaining = 0

    def start(self, percent, seconds, on_tick):
        with self.lock:
            self._cancel_locked()
            saved = self.fan.snapshot()
            self.fan.set_manual(round(percent / 100 * 255))
            self.remaining = seconds
            self._stop.clear()

            def _finish():
                with self.lock:
                    self.fan.restore(saved)
                    self.remaining = 0
                    self._stop.set()
                    on_tick(0)
                log("trial finished, previous fan state restored")

            def _ticker():
                end = time.time() + seconds
                while not self._stop.wait(1.0):
                    left = max(0, int(end - time.time()))
                    on_tick(left)
                    if left <= 0:
                        break

            self.timer = threading.Timer(seconds, _finish)
            self.timer.daemon = True
            self.timer.start()
            threading.Thread(target=_ticker, daemon=True).start()
            on_tick(seconds)
            log(f"trial started: {percent}% for {seconds}s")

    def cancel(self):
        with self.lock:
            self._cancel_locked()

    def _cancel_locked(self):
        if self.timer is not None:
            self.timer.cancel()
            self.timer = None
        self._stop.set()
        self.remaining = 0


# ---------------------------------------------------------------- sensors

def collect_temps():
    """[(chip_key, idx, label, celsius)] from it8613, coretemp, nvme."""
    out, seen_dirs = [], set()
    for chip_key, needles in (("it8613", ("it8613", "it87")),
                              ("coretemp", ("coretemp",)),
                              ("nvme", ("nvme",))):
        for d, _name in find_chips(*needles):
            if d in seen_dirs:
                continue
            seen_dirs.add(d)
            for i in numbered_indices(d, "temp", "_input"):
                raw = read_int(f"{d}/temp{i}_input")
                if raw is None:
                    continue
                label = read_file(f"{d}/temp{i}_label") or f"Temperature {i}"
                out.append({"chip": chip_key, "idx": i,
                            "label": label, "celsius": raw / 1000.0})
    return out


def collect_fans(fan):
    """[(idx, label, rpm)] from the it8613 chip."""
    out = []
    if fan.hwmon:
        for i in numbered_indices(fan.hwmon, "fan", "_input"):
            rpm = read_int(f"{fan.hwmon}/fan{i}_input")
            if rpm is None:
                continue
            label = read_file(f"{fan.hwmon}/fan{i}_label") or f"Fan {i}"
            out.append({"idx": i, "label": label, "rpm": rpm})
    return out


# --------------------------------------------------------------- discovery

def availability_cfg():
    return {
        "availability_topic": STATUS_TOPIC,
        "payload_available": "online",
        "payload_not_available": "offline",
    }


def discovery_payloads(fan, temps, fans):
    """List of (config_topic, payload)."""
    cfgs = []

    def sensor(uid, name, state_topic, extra):
        payload = {"name": name, "object_id": uid, "unique_id": uid,
                   "state_topic": state_topic, "device": DEVICE_INFO}
        payload.update(availability_cfg())
        payload.update(extra)
        cfgs.append((f"{DISCOVERY_PREFIX}/sensor/{uid}/config", payload))

    for t in temps:
        uid = f"{DEVICE_NAME}_{t['chip']}_temp{t['idx']}_{slug(t['label'])}"
        sensor(uid, t["label"], f"{BASE}/{t['chip']}/temp{t['idx']}",
               {"device_class": "temperature",
                "unit_of_measurement": "\u00b0C",
                "state_class": "measurement"})

    for f in fans:
        uid = f"{DEVICE_NAME}_it8613_fan{f['idx']}_{slug(f['label'])}"
        sensor(uid, f"{f['label']} speed", f"{BASE}/it8613/fan{f['idx']}",
               {"unit_of_measurement": "rpm", "icon": "mdi:fan",
                "state_class": "measurement"})

    if fan.hwmon:
        # Fan entity: percentage + preset modes (Auto / Manual / Quiet).
        uid = f"{DEVICE_NAME}_fan"
        cfgs.append((f"{DISCOVERY_PREFIX}/fan/{uid}/config", {
            "name": "Fan",
            "object_id": uid, "unique_id": uid,
            "icon": "mdi:fan",
            "percentage_command_topic": f"{BASE}/fan/percentage/set",
            "percentage_state_topic": f"{BASE}/fan/percentage",
            "preset_mode_command_topic": f"{BASE}/fan/preset/set",
            "preset_mode_state_topic": f"{BASE}/fan/preset",
            "preset_modes": ["Auto", "Manual", "Quiet"],
            "device": DEVICE_INFO, **availability_cfg(),
        }))

        def button(uid_suffix, name, command_topic):
            uid = f"{DEVICE_NAME}_{uid_suffix}"
            cfgs.append((f"{DISCOVERY_PREFIX}/button/{uid}/config", {
                "name": name, "object_id": uid, "unique_id": uid,
                "command_topic": command_topic, "payload_press": "PRESS",
                "device": DEVICE_INFO, **availability_cfg(),
            }))

        button("quiet", "Enable quiet mode", f"{BASE}/quiet/set")
        button("trial", "Start 2-minute trial", f"{BASE}/trial/set")
        button("restore_firmware", "Restore firmware", f"{BASE}/restore/set")

        sensor(f"{DEVICE_NAME}_trial_remaining", "Trial remaining",
               TRIAL_REMAINING_TOPIC,
               {"unit_of_measurement": "s", "icon": "mdi:timer"})

    return cfgs


# ------------------------------------------------------------------- main

def make_client():
    try:
        client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION1,
                             client_id=f"{DEVICE_NAME}-fanctl")
    except AttributeError:  # paho-mqtt 1.x
        client = mqtt.Client(client_id=f"{DEVICE_NAME}-fanctl")
    if MQTT_USER:
        client.username_pw_set(MQTT_USER, MQTT_PASS or None)
    client.will_set(STATUS_TOPIC, payload="offline", qos=1, retain=True)
    client.reconnect_delay_set(min_delay=1, max_delay=30)
    return client


def main():
    fan = FanController()
    if fan.hwmon:
        log(f"fan chip: {fan.chip_name} at {fan.hwmon}, "
            f"pwm channels: {fan.pwm_channels}")
    else:
        log("WARN: no it8613/it87 hwmon device; fan control unavailable "
            "(temperatures will still be published)")

    trial = TrialManager(fan)
    client = make_client()
    published_sig = [None]  # mutable holder for the on_connect closure

    # ------------------------------------------------------- publishing
    def publish_discovery(temps, fans):
        cfgs = discovery_payloads(fan, temps, fans)
        sig = tuple(sorted(c[0] for c in cfgs))
        if sig == published_sig[0]:
            return
        for topic, payload in cfgs:
            client.publish(topic, json.dumps(payload), qos=1, retain=True)
        published_sig[0] = sig
        log(f"published {len(cfgs)} discovery configs")

    def publish_states(temps, fans):
        for t in temps:
            client.publish(f"{BASE}/{t['chip']}/temp{t['idx']}",
                           f"{t['celsius']:.1f}", qos=0)
        for f in fans:
            client.publish(f"{BASE}/it8613/fan{f['idx']}",
                           str(f["rpm"]), qos=0)
        if fan.hwmon:
            client.publish(f"{BASE}/fan/percentage",
                           str(fan.current_percent()), qos=0)
            client.publish(f"{BASE}/fan/preset",
                           fan.current_preset(), qos=0)

    def publish_trial_remaining(remaining):
        client.publish(TRIAL_REMAINING_TOPIC, str(remaining),
                       qos=0, retain=True)

    # ------------------------------------------------------- commands
    def on_message(_c, _u, msg):
        topic = msg.topic
        payload = msg.payload.decode("utf-8", "replace").strip()
        log(f"command {topic} <- {payload!r}")
        try:
            if not fan.hwmon:
                log("WARN: no fan chip, ignoring command")
                return
            if topic == f"{BASE}/fan/percentage/set":
                pct = max(0, min(100, int(float(payload))))
                fan.set_manual(round(pct * 255 / 100))
            elif topic == f"{BASE}/fan/preset/set":
                mode = payload.lower()
                if mode == "auto":
                    trial.cancel()
                    fan.set_auto()
                elif mode == "manual":
                    fan.set_manual_keep_duty()
                elif mode == "quiet":
                    fan.set_manual(QUIET_PWM)
                else:
                    log(f"WARN: unknown preset {payload!r}")
                    return
            elif topic == f"{BASE}/quiet/set":
                fan.set_manual(QUIET_PWM)
            elif topic == f"{BASE}/trial/set":
                percent, seconds = TRIAL_DEFAULT_PERCENT, TRIAL_DEFAULT_SECONDS
                if payload and payload.upper() != "PRESS":
                    try:
                        data = json.loads(payload)
                        percent = int(data.get("percent", percent))
                        seconds = int(data.get("seconds", seconds))
                    except (ValueError, AttributeError, TypeError):
                        percent = int(float(payload))  # plain number = percent
                percent = max(0, min(100, percent))
                seconds = max(5, min(600, seconds))
                trial.start(percent, seconds, publish_trial_remaining)
            elif topic == f"{BASE}/restore/set":
                trial.cancel()
                fan.set_auto()
                publish_trial_remaining(0)
                log("firmware (EC automatic) fan control restored")
            else:
                return
            publish_states(collect_temps(), collect_fans(fan))
        except Exception as exc:  # never let a bad command kill the bridge
            log(f"WARN: command {topic} failed: {exc}")

    def on_connect(_c, _u, _flags, rc):
        if rc != 0:
            log(f"MQTT connect failed, rc={rc}")
            return
        log(f"connected to MQTT {MQTT_HOST}:{MQTT_PORT}")
        for t in (f"{BASE}/fan/percentage/set",
                  f"{BASE}/fan/preset/set",
                  f"{BASE}/quiet/set",
                  f"{BASE}/trial/set",
                  f"{BASE}/restore/set"):
            client.subscribe(t, qos=1)
        client.publish(STATUS_TOPIC, "online", qos=1, retain=True)
        temps, fans = collect_temps(), collect_fans(fan)
        published_sig[0] = None  # force (re)publish of discovery
        publish_discovery(temps, fans)
        publish_trial_remaining(trial.remaining)
        publish_states(temps, fans)

    client.on_connect = on_connect
    client.on_message = on_message

    # ------------------------------------------------------- shutdown
    def _shutdown(signum, _frame):
        log(f"signal {signum}: restoring firmware fan control, exiting")
        try:
            trial.cancel()
            if fan.hwmon:
                fan.set_auto()
        except Exception as exc:
            log(f"WARN during shutdown: {exc}")
        finally:
            shutdown_requested.set()

    signal.signal(signal.SIGTERM, _shutdown)
    signal.signal(signal.SIGINT, _shutdown)

    # ------------------------------------------------------- run
    log(f"connecting to MQTT {MQTT_HOST}:{MQTT_PORT} ...")
    client.loop_start()
    while not shutdown_requested.is_set():
        try:
            client.connect(MQTT_HOST, MQTT_PORT, keepalive=60)
            break  # further reconnects are handled by paho's loop
        except Exception as exc:
            log(f"MQTT connect failed ({exc}); retrying in 5s")
            if shutdown_requested.wait(5):
                break

    while not shutdown_requested.is_set():
        if not fan.hwmon:
            # Chip may appear later (e.g. driver loaded after bridge start).
            if fan.refresh():
                log(f"fan chip appeared: {fan.chip_name} at {fan.hwmon}")
                published_sig[0] = None
        temps, fans = collect_temps(), collect_fans(fan)
        publish_discovery(temps, fans)
        publish_states(temps, fans)
        shutdown_requested.wait(SCAN_INTERVAL)

    client.loop_stop()
    try:
        client.publish(STATUS_TOPIC, "offline", qos=1, retain=True)
        client.disconnect()
    except Exception:
        pass
    log("bridge stopped")


if __name__ == "__main__":
    main()
