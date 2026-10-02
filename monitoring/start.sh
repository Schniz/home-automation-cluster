#!/usr/bin/env bash
set -euo pipefail

# This file exists only inside the budgeted filesystem, not the mount directory.
if [[ ! -f /data/.lgtm-budget-20gib ]]; then
  echo "LGTM requires the mounted 20 GiB filesystem. Run the Ansible playbook first." >&2
  exit 1
fi

exec /otel-lgtm/run-all.sh
