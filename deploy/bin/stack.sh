#!/usr/bin/env bash
# VM mode (ADR-0011): `stack.sh up|down|build` with the same profiles every time, used by
# deploy.sh and the systemd unit, so a reboot runs exactly what a deploy runs.
# `stack.sh run COMMAND...` runs one worker command in the jobs image (the poll timer).
set -euo pipefail
. "$(dirname "$0")/lib.sh"

compose() { docker compose -f "$COMPOSE_FILE" "$@"; }

case "${1:?usage: stack.sh up|down|build|run COMMAND...}" in
  build)
    # Every image, including the one-off jobs image and SeaweedFS.
    compose --profile jobs --profile local-s3 build
    ;;
  up)
    if files_on_vm; then
      compose --profile local-s3 up -d --wait --remove-orphans
      # P2-W11-S01: the private content bucket, made once (a second create fails).
      compose --profile local-s3 exec -T seaweedfs sh -c \
        "echo s3.bucket.list | weed shell | grep -qw '${LOCAL_BUCKET}' \
          || echo 's3.bucket.create -name ${LOCAL_BUCKET}' | weed shell"
    else
      # Switching back to S3 must stop SeaweedFS; --remove-orphans ignores profiled services.
      compose --profile local-s3 rm --stop --force seaweedfs
      compose up -d --wait --remove-orphans
    fi
    ;;
  down)
    compose --profile local-s3 --profile jobs down
    ;;
  run)
    shift
    # A deploy in progress may have a new image and an old schema: skip this run.
    exec 9>/run/interval-deploy.lock
    flock -n 9 || { echo "deploy in progress; skipping" >&2; exit 0; }
    compose --profile jobs run --rm --no-deps jobs "$@"
    ;;
  *)
    echo "usage: stack.sh up|down|build|run COMMAND..." >&2
    exit 2
    ;;
esac
