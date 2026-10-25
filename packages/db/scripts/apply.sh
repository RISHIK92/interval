#!/usr/bin/env bash
# Applies pending migrations to $DATABASE_URL without regenerating types; tests depend on it.
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is not set; copy .env.example to .env}"
db_dir="$(cd "$(dirname "$0")/.." && pwd)"
. "$db_dir/scripts/require-local-db.sh"
require_local_db "$DATABASE_URL"

dbmate --url "$DATABASE_URL" --migrations-dir "$db_dir/migrations" --no-dump-schema up
