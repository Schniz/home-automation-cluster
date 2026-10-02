#!/usr/bin/env bash
#
# beelink-fan entrypoint: ensure kernel headers, ensure the it87 driver is
# loaded and exposing the IT8613E hwmon device, then exec the MQTT bridge.
#
# Env knobs:
#   IT87_OPTS      module options, default "ignore_resource_conflict=1 mmio=off"
#   IT87_FORCE_ID  optional fallback chip id, e.g. "0x8622"
#   IT87_SRC       driver source dir, default /opt/it87-src (baked into image)
#
set -euo pipefail

log() { echo "[entrypoint] $*"; }

KVER="$(uname -r)"
log "host kernel: $KVER"

# ---------------------------------------------------------------- headers
# The build needs /lib/modules/<kver>/build. /lib/modules is bind-mounted
# from the host, so the headers land in the host's module tree (standard
# Ubuntu packages - harmless, and required for any out-of-tree build).
if [ ! -d "/lib/modules/${KVER}/build" ]; then
    log "installing linux-headers-${KVER} ..."
    apt-get update -qq
    apt-get install -y -qq "linux-headers-${KVER}"
else
    log "kernel headers already present"
fi

# ------------------------------------------------- is the chip already up?
has_it8613() {
    local d n
    for d in /sys/class/hwmon/hwmon*; do
        [ -f "$d/name" ] || continue
        n="$(cat "$d/name" 2>/dev/null || true)"
        case "$n" in
            *it8613*|*it87*) return 0 ;;
        esac
    done
    return 1
}

IT87_OPTS="${IT87_OPTS:-ignore_resource_conflict=1 mmio=off}"
IT87_FORCE_ID="${IT87_FORCE_ID:-}"
OPTS="${IT87_OPTS}"
[ -n "${IT87_FORCE_ID}" ] && OPTS="${OPTS} force_id=${IT87_FORCE_ID}"

try_modprobe() {
    # shellcheck disable=SC2086
    if modprobe it87 $OPTS 2>/dev/null; then
        log "modprobe it87 succeeded (options: ${OPTS})"
        sleep 2
        return 0
    fi
    return 1
}

if has_it8613; then
    log "it8613/it87 hwmon device already present - skipping driver load"
else
    # A previously installed (host-side or DKMS) module may just need loading.
    if ! try_modprobe || ! has_it8613; then
        modprobe -r it87 2>/dev/null || true
        SRC="${IT87_SRC:-/opt/it87-src}"
        if [ ! -f "${SRC}/Makefile" ]; then
            log "cloning frankcrawford/it87 ..."
            rm -rf "${SRC}"
            git clone --depth 1 https://github.com/frankcrawford/it87.git "${SRC}"
        fi
        log "building it87 against ${KVER} ..."
        make -C "${SRC}" clean >/dev/null
        make -C "${SRC}" -j"$(nproc)"
        KO="$(find "${SRC}" -maxdepth 2 -name 'it87.ko' | head -1)"
        [ -n "${KO}" ] || { log "ERROR: build produced no it87.ko"; exit 1; }
        log "loading ${KO} (options: ${OPTS})"
        # shellcheck disable=SC2086
        insmod "${KO}" $OPTS || {
            log "ERROR: insmod failed - kernel messages:"
            dmesg | tail -25
            log "hints: Secure Boot must be disabled for unsigned modules;"
            log "       try IT87_FORCE_ID=0x8622 if the chip is not detected"
            exit 1
        }
        sleep 2
    fi
fi

# ------------------------------------------------------------- diagnostics
if has_it8613; then
    log "it8613 device detected:"
    for d in /sys/class/hwmon/hwmon*; do
        n="$(cat "$d/name" 2>/dev/null || true)"
        case "$n" in
            *it8613*|*it87*)
                echo "  $d (name=$n)"
                for f in "$d"/fan*_input "$d"/pwm[0-9] "$d"/pwm*_enable "$d"/temp*_input; do
                    [ -e "$f" ] || continue
                    printf '    %-16s %s\n' "$(basename "$f")" "$(cat "$f" 2>/dev/null || '?')"
                done
                ;;
        esac
    done
else
    log "WARNING: no it8613 hwmon device - bridge will run in monitor-only mode"
fi

log "starting bridge"
exec python3 /app/bridge.py
