#!/usr/bin/env bash
# VM mode (ADR-0011): `stack.sh up|down|build` with the same profiles every time, used by
# deploy.sh and the systemd unit, so a reboot runs exactly what a deploy runs.
# `stack.sh run COMMAND...` runs one worker command in the jobs image (the poll timer).
set -euo pipefail
. "$(dirname "$0")/lib.sh"

compose() { docker compose -f "$COMPOSE_FILE" "$@"; }

case "${1:?usage: stack.sh up|down|build|run COMMAND...}" in
  build)
    # Every image, including the one-off jobs image.
    compose --profile jobs build
    ;;
  up)
    # P4-W22-S04 (owner, 2026-11-10): SeaweedFS always runs, for public media; the
    # private bucket is made on it only when the private files live on the VM too.
    # SeaweedFS's data sits on the mounted data volume; made there if missing, never on
    # the root disk (an unmounted volume fails the start instead).
    files_dir="${FILES_DIR:-/var/lib/interval/pgdata/files}"
    if [ ! -d "$files_dir" ] && mountpoint -q "$(dirname "$files_dir")"; then
      mkdir -p "$files_dir"
    fi
    compose up -d --wait --remove-orphans
    buckets="${MEDIA_BUCKET}"
    if files_on_vm; then buckets="${LOCAL_BUCKET} ${MEDIA_BUCKET}"; fi
    for bucket in $buckets; do
      # Made once (a second create fails).
      compose exec -T seaweedfs sh -c \
        "echo s3.bucket.list | weed shell | grep -qw '${bucket}' \
          || echo 's3.bucket.create -name ${bucket}' | weed shell"
    done
    ;;
  down)
    compose --profile jobs down
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
