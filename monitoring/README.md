# Monitoring

Grafana is served at https://monitoring.home.hagever.com. Log in with
`admin` / `admin` on first use and change the password. Anonymous access is disabled.

## Storage

Docker creates `/media/SchlezExt/configs/lgtm/data` on the external disk.
This is the container's `/data` directory, with no fixed size limit.
The container root filesystem is read-only, and temporary files use bounded
RAM filesystems. Container stdout/stderr logs are limited to three 10 MB files.

Metrics (Prometheus), logs (Loki), traces (Tempo), and profiles (Pyroscope) all
have **two-day retention**. Loki and Tempo accept approximately 25 KiB/s each,
with 4 MiB bursts.
Collector queues use the upstream in-memory defaults; no persistent queue is enabled.

Deletion runs in the background and can lag behind 48 hours. WALs, indexes, and
compaction work also use disk space. Do not manually delete backend files while
the stack is running.

Inspect storage on the host:

```sh
df -h /media/SchlezExt/configs/lgtm/data
sudo du -h -d 1 /media/SchlezExt/configs/lgtm/data
```

## Sending telemetry

Containers on the `caddy` network can use:

```sh
OTEL_EXPORTER_OTLP_ENDPOINT=http://lgtm:4318
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
```

Host and LAN applications can use `http://192.168.31.38:4318`, or port `4317`
for OTLP/gRPC. The ingestion ports are bound to the host's LAN address.
Applications must send telemetry explicitly; this service does not collect every
container's Docker logs automatically.

## Image updates

`grafana/otel-lgtm:latest` is used because upstream publishes no major-only tag.
Watchtower can update it, including across future major versions. Backend config
was checked against LGTM 0.34.0 (Tempo 3 and Pyroscope 2).
