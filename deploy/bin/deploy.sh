#!/usr/bin/env bash
# VM mode (ADR-0011): build and (re)start the stack at a git ref (branch, tag or SHA).
# Run as root on the VM through SSM: `/opt/interval/deploy/bin/deploy.sh <ref>`.
# See docs/runbooks/vm.md.
set -euo pipefail

ref="${1:?usage: deploy.sh <branch|tag|sha>}"
APP_DIR="${APP_DIR:-/opt/interval}"
REPO_URL="${REPO_URL:-https://github.com/RISHIK92/interval.git}"

# One deploy (or restart) at a time.
exec 9>/run/interval-deploy.lock
flock -n 9 || { echo "another deploy is running" >&2; exit 1; }

if [ "${INTERVAL_DEPLOY_STAGE:-1}" = "1" ]; then
  if [ ! -d "$APP_DIR/.git" ]; then
    git clone --quiet "$REPO_URL" "$APP_DIR"
  fi
  git -C "$APP_DIR" fetch --quiet --tags --force origin
  # A branch name means the remote branch, never a stale local one.
  if commit="$(git -C "$APP_DIR" rev-parse --verify --quiet "origin/$ref^{commit}")"; then :
  elif commit="$(git -C "$APP_DIR" rev-parse --verify --quiet "$ref^{commit}")"; then :
  else
    echo "unknown ref: $ref" >&2
    exit 1
  fi
  git -C "$APP_DIR" checkout --quiet --detach "$commit"
  # Continue with the deploy script from the new checkout.
  exec 9>&-
  INTERVAL_DEPLOY_STAGE=2 exec "$APP_DIR/deploy/bin/deploy.sh" "$ref"
fi

. "$APP_DIR/deploy/bin/lib.sh"

# Postgres data and VM-local files must be on the dedicated volume, never the root disk.
mountpoint -q "$DATA_MOUNT" || { echo "$DATA_MOUNT is not mounted" >&2; exit 1; }
install -d -o 999 -g 999 -m 700 "$DATA_MOUNT/data"   # postgres uid in the image
install -d -o 999 -g 1000 -m 700 "$DATA_MOUNT/valkey" # valkey uid/gid in the image (ADR-0014)
install -d -m 700 "$DATA_MOUNT/files" "$INTERVAL_ETC"

"$APP_DIR/deploy/bin/write-env.sh"
"$APP_DIR/deploy/bin/stack.sh" build
"$APP_DIR/deploy/bin/stack.sh" up

for unit in interval.service interval-poll.service interval-poll.timer \
  interval-recompute.service interval-recompute.timer \
  interval-links.service interval-links.timer \
  interval-spot-checks.service interval-spot-checks.timer \
  interval-question-batches.service interval-question-batches.timer; do
  install -m 644 "$APP_DIR/deploy/systemd/$unit" "/etc/systemd/system/$unit"
done
systemctl daemon-reload
systemctl enable interval.service
# Active in systemd's eyes (a no-op once the stack is up), so the poll timer's
# Requisite holds from the first deploy.
systemctl start interval.service
# ING-3: polls due sources every 5 minutes, as EventBridge Scheduler does in AWS mode.
systemctl enable --now interval-poll.timer
# Q-P1-17: recomputes active users' feeds hourly, as EventBridge Scheduler does in AWS.
systemctl enable --now interval-recompute.timer
# ING-6: checks every item's link weekly, as EventBridge Scheduler does in AWS mode.
systemctl enable --now interval-links.timer
# Q-2: queues the week's question spot checks, as EventBridge Scheduler does in AWS.
systemctl enable --now interval-spot-checks.timer
# Q-P2-13: question batches every 30 minutes, as EventBridge Scheduler does in AWS.
systemctl enable --now interval-question-batches.timer
docker image prune -f >/dev/null

echo "Deployed $(git -C "$APP_DIR" rev-parse --short HEAD)"
