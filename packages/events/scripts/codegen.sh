#!/usr/bin/env bash
# Writes the generated event types from events.json (DB-5, Q-P1-20): TS to $1 and Python to
# $2 (defaults: the committed files), formatted like the hand-written code.
set -euo pipefail

pkg_dir="$(cd "$(dirname "$0")/.." && pwd)"
repo_root="$(cd "$pkg_dir/../.." && pwd)"
ts_out="${1:-$pkg_dir/src/generated.ts}"
py_out="${2:-$repo_root/workers/jobs/src/interval_jobs/events/generated.py}"

node "$pkg_dir/scripts/codegen.ts" "$pkg_dir/events.json" "$ts_out" "$py_out"
"$repo_root/node_modules/.bin/prettier" --log-level warn --write "$ts_out"
uv run --locked --project "$repo_root" ruff check --quiet --fix --select I "$py_out"
uv run --locked --project "$repo_root" ruff format --quiet "$py_out"
