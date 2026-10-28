#!/usr/bin/env bash
# Shared by the VM scripts (ADR-0011). Sourced, not run.

APP_DIR="${APP_DIR:-/opt/interval}"
DATA_MOUNT="/var/lib/interval/pgdata"
# Config lives on the retained data volume, so it survives replacing the VM.
INTERVAL_ETC="${INTERVAL_ETC:-$DATA_MOUNT/etc}"
COMPOSE_FILE="$APP_DIR/deploy/compose.prod.yml"

# Prints the contents of a one-line config file, or nothing if it is missing.
read_setting() {
  local file="$INTERVAL_ETC/$1"
  if [ -f "$file" ]; then tr -d '[:space:]' < "$file"; fi
}

# The private content bucket in SeaweedFS when files live on the VM (P2-W11-S01).
LOCAL_BUCKET="interval-private"

files_on_vm() {
  [ "$(read_setting files-backend)" = "local-s3" ]
}
