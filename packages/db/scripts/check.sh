#!/usr/bin/env bash
# Fails if the committed generated types differ from a fresh migrate + codegen on an empty database.
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is not set; copy .env.example to .env}"
db_dir="$(cd "$(dirname "$0")/.." && pwd)"
. "$db_dir/scripts/require-local-db.sh"
require_local_db "$DATABASE_URL"

base="${DATABASE_URL%%\?*}"
query="${DATABASE_URL#"$base"}"
authority="${base#*://}"
if [ "${authority#*/}" = "$authority" ] || [ -z "${authority#*/}" ]; then
  echo "DATABASE_URL has no database name: $base" >&2
  exit 1
fi
# The PID keeps parallel runs (two worktrees) from dropping each other's database.
check_url="${base%/*}/interval_check_$$${query}"

tmp=""
cleanup() {
  if [ -n "$tmp" ]; then rm -r "$tmp"; fi
  dbmate --url "$check_url" drop >/dev/null 2>&1 || true
}
trap cleanup EXIT
# Turbo stops sibling tasks with a signal; exiting runs the EXIT trap.
trap 'exit 130' INT
trap 'exit 143' TERM

dbmate --url "$check_url" create >/dev/null
tmp="$(mktemp -d)"

"$db_dir/scripts/codegen.sh" "$check_url" "$tmp/db.ts" "$tmp/generated.py" \
  "$tmp/messages.ts" "$tmp/messages.py" >/dev/null

status=0
diff -u "$db_dir/src/generated/db.ts" "$tmp/db.ts" || status=1
diff -u "$db_dir/python/src/interval_db/generated.py" "$tmp/generated.py" || status=1
diff -u "$db_dir/src/generated/messages.ts" "$tmp/messages.ts" || status=1
diff -u "$db_dir/python/src/interval_db/messages.py" "$tmp/messages.py" || status=1
if [ "$status" -ne 0 ]; then
  echo "Generated types are stale. Run \`pnpm db:migrate\` and commit the result." >&2
fi
exit "$status"
