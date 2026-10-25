#!/usr/bin/env bash
# Migrates the database at $1, then writes generated TS types to $2 and Python types to $3 (ADR-0002).
set -euo pipefail

url="$1"
ts_out="$2"
py_out="$3"
db_dir="$(cd "$(dirname "$0")/.." && pwd)"
repo_root="$(cd "$db_dir/../.." && pwd)"
. "$db_dir/scripts/require-local-db.sh"
require_local_db "$url"

dbmate --url "$url" --migrations-dir "$db_dir/migrations" --no-dump-schema up
# Same scope as the Python generator: tables and views in `public`.
"$db_dir/node_modules/.bin/kysely-codegen" --dialect postgres --url "$url" \
  --include-pattern 'public.*' --exclude-pattern 'public.schema_migrations' --out-file "$ts_out"
uv run --locked --project "$repo_root" python -m interval_db.codegen "$url" "$py_out"
uv run --locked --project "$repo_root" ruff check --quiet --fix --select I "$py_out"
uv run --locked --project "$repo_root" ruff format --quiet "$py_out"
