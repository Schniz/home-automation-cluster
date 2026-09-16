# beelink-fan

Privileged sidecar for the **Beelink S12** (Intel N100, ITE IT8613E Super I/O)
that exposes the fan controller + temperature sensors to Home Assistant —
the same architecture as the custom HP Elite Mini 805 setup: driver + bridge
in a container with host device paths mounted.

## What it does

- Builds and loads the out-of-tree [`frankcrawford/it87`](https://github.com/frankcrawford/it87)
  kernel module at container startup (native IT8613E support; the mainline
  `it87` driver doesn't know this chip). Rebuilds automatically after host
  kernel updates.
- Bridges hwmon sensors to the cluster's **mosquitto** broker with Home
  Assistant auto-discovery:
  - temperature sensors — IT8613E channels, CPU (coretemp), NVMe drive
  - fan RPM sensors
  - a **fan entity** with percentage control + presets **Auto / Manual / Quiet**
  - buttons: **Enable quiet mode**, **Start 2-minute trial**, **Restore firmware**
  - a **Trial remaining** countdown sensor
- Trial mode sets a manual duty for N seconds, then restores the previous fan
  state. Restore returns all channels to EC automatic control (`pwm_enable=2`).

## Wiring

- Service definition lives in `composer/src/machine1.ts` (`beelink-fan`);
  `docker-compose.yml` is regenerated from it (`cd composer && bun run generate ../docker-compose.yml`).
- Image is built by `.github/workflows/docker-beelink-fan.yml` and published
  to `ghcr.io/schniz/home-automation-cluster-beelink-fan:main` on pushes to
  `main` (same pattern as the caddy image).
- Publishes to the existing `mosquitto` service (`MQTT_HOST=mosquitto` via the
  `caddy` network).

## Setup

```bash
cp beelink-fan/environment.example beelink-fan/environment
# edit beelink-fan/environment only if your mosquitto broker needs auth
# (MQTT_USER / MQTT_PASS); leave empty for anonymous brokers

# regenerate + deploy
cd composer && bun run generate ../docker-compose.yml && cd ..
docker compose up -d beelink-fan
docker logs -f beelink-fan
```

You should see the `it8613-isa-...` device with `fan1_input`, `pwm1`, and
`temp*_input` lines, then `connected to MQTT`.

## Requirements

- Runs on the Beelink S12 host (x86_64, Ubuntu/Debian).
- **Secure Boot disabled** (`mokutil --sb-state`) — an unsigned out-of-tree
  module will not load otherwise (or sign the module and enroll a MOK).
- `linux-headers-$(uname -r)` installable via apt (entrypoint installs it).
- `--privileged`: loads a kernel module (`CAP_SYS_MODULE`), touches Super I/O
  ports, reads `/sys` + `/dev`. Pragmatic on a trusted homelab host.

## Env knobs

| Variable | Default | Purpose |
|---|---|---|
| `MQTT_HOST` / `MQTT_PORT` | `mosquitto` / `1883` | broker |
| `MQTT_USER` / `MQTT_PASS` | (anonymous) | broker auth |
| `IT87_OPTS` | `ignore_resource_conflict=1 mmio=off` | module options |
| `IT87_FORCE_ID` | (unset) | e.g. `0x8622` if the chip isn't detected |
| `QUIET_PWM` | `64` | quiet-mode duty (of 255) |
| `TRIAL_DEFAULT_PERCENT` / `TRIAL_DEFAULT_SECONDS` | `60` / `120` | trial defaults |

## Troubleshooting

- `insmod failed` → check `dmesg`; Secure Boot is the usual culprit.
- Chip not detected → try `IT87_FORCE_ID=0x8622` in `environment`.
- After a host kernel update the container rebuilds the module on next start.
- The bridge never stops the fan: on SIGTERM it returns all channels to EC
  automatic control.
