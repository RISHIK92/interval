#!/usr/bin/env bash
# Fails if a migration that exists at <base> was changed, deleted or renamed since
# (ADR-0002: merged migrations are immutable; add a new one instead). New files pass.
set -euo pipefail

base="${1:?usage: check-migrations-immutable.sh <base-commit>}"

# --no-renames reports a rename as delete + add, so the deleted name is caught.
changed="$(git diff --no-renames --name-status "$base"...HEAD -- packages/db/migrations \
  | awk '$1 != "A" { print $2 }')"

if [ -n "$changed" ]; then
  echo "Merged migrations must not change; add a new migration instead:" >&2
  echo "$changed" | sed 's/^/  /' >&2
  exit 1
fi
