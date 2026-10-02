# Monitoring

Grafana is served at https://monitoring.home.hagever.com. Log in with
`admin` / `admin` on first use and change the password. Anonymous access is disabled.

Run the Ansible playbook before starting `lgtm`. The normal deployment workflow
does this automatically.

## Storage

Ansible allocates a **20 GiB** file at
`/media/SchlezExt/configs/lgtm/data.ext4`, formats it as ext4, and mounts it at
`/media/SchlezExt/configs/lgtm/data`. This is the container's `/data` directory.
Allocation reserves the space on the external disk. Filesystem metadata reduces
the usable capacity slightly. The external filesystem must support `fallocate`.

Docker requires this mount at boot. Container startup also checks a marker inside
the mounted filesystem. The container root filesystem is read-only, and temporary
files use bounded RAM filesystems.

The 20 GiB budget includes Grafana data, plugins, telemetry, indexes, WALs, and
compaction work. Docker image layers and rotated container stdout/stderr logs are
outside this budget; the latter are limited to three 10 MB files.

All signals have 72-hour retention. Prometheus also has 5 GiB size retention;
its WAL and compaction need additional space. Loki and Tempo accept approximately
25 KiB/s each, with 4 MiB bursts. These are input limits, not disk size guarantees.
Collector queues use the upstream in-memory defaults; no persistent queue is enabled.

Deletion runs in the background and can lag behind 72 hours. At full capacity,
new writes can fail. The fixed filesystem prevents telemetry from growing beyond
the budget. Do not manually delete backend files while the stack is running.

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
