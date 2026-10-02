# beelink-fan: privileged sidecar that builds + loads the frankcrawford/it87
# driver for the ITE IT8613E Super I/O, then bridges hwmon sensors to MQTT
# for Home Assistant auto-discovery.
#
# Kernel headers are deliberately NOT baked in: they must match the *host*
# kernel at runtime (uname -r inside the container reports the host kernel),
# so entrypoint.sh installs them on startup.
FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        git \
        ca-certificates \
        kmod \
        python3 \
        python3-pip \
    && rm -rf /var/lib/apt/lists/*

RUN pip3 install --no-cache-dir "paho-mqtt>=1.6"

# Pre-fetch driver source so the container can (re)build even if the network
# is unavailable at startup. Rebuilt against the running kernel on every start
# where the module isn't already loaded (covers host kernel updates).
RUN git clone --depth 1 https://github.com/frankcrawford/it87.git /opt/it87-src

WORKDIR /app
COPY bridge.py /app/bridge.py
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh /app/bridge.py

ENTRYPOINT ["/entrypoint.sh"]
