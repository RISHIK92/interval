#!/usr/bin/env bash
# Fails when the committed generated files are not what events.json produces.
set -euo pipefail

pkg_dir="$(cd "$(dirname "$0")/.." && pwd)"
repo_root="$(cd "$pkg_dir/../.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -r "$tmp"' EXIT
"$pkg_dir/scripts/codegen.sh" "$tmp/generated.ts" "$tmp/generated.py"
status=0
diff -u "$pkg_dir/src/generated.ts" "$tmp/generated.ts" || status=1
diff -u "$repo_root/workers/jobs/src/interval_jobs/events/generated.py" "$tmp/generated.py" || status=1
if [ "$status" -ne 0 ]; then
  echo "Generated event types are stale: run pnpm events:codegen" >&2
fi
exit "$status"
