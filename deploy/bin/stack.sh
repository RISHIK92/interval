#!/usr/bin/env bash
# VM mode (ADR-0011): `stack.sh up|down|build` with the same profiles every time, used by
# deploy.sh and the systemd unit, so a reboot runs exactly what a deploy runs.
set -euo pipefail
. "$(dirname "$0")/lib.sh"

compose() { docker compose -f "$COMPOSE_FILE" "$@"; }

case "${1:?usage: stack.sh up|down|build}" in
  build)
    # Every image, including the one-off jobs image and SeaweedFS.
    compose --profile jobs --profile local-s3 build
    ;;
  up)
    if files_on_vm; then
      compose --profile local-s3 up -d --wait --remove-orphans
    else
      # Switching back to S3 must stop SeaweedFS; --remove-orphans ignores profiled services.
      compose --profile local-s3 rm --stop --force seaweedfs
      compose up -d --wait --remove-orphans
    fi
    ;;
  down)
    compose --profile local-s3 --profile jobs down
    ;;
  *)
    echo "usage: stack.sh up|down|build" >&2
    exit 2
    ;;
esac
