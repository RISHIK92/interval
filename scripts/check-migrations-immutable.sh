#!/usr/bin/env bash
# Fails if a migration that exists at <base> was changed, deleted or renamed since
# (ADR-0002: merged migrations are immutable; add a new one instead). New files pass.
#
# Usage: check-migrations-immutable.sh <base-commit> pr|push
#   pr:   base is the target branch tip; the three-dot diff compares from the merge base.
#   push: base is the previous tip of the pushed branch and must be an ancestor of HEAD;
#         otherwise history was rewritten (force-push) and the check cannot be trusted.
set -euo pipefail

base="${1:?usage: check-migrations-immutable.sh <base-commit> pr|push}"
mode="${2:?usage: check-migrations-immutable.sh <base-commit> pr|push}"

if ! git cat-file -e "${base}^{commit}" 2>/dev/null; then
  echo "Base commit $base not found (force-push or shallow clone?); cannot check migrations." >&2
  exit 1
fi
if [ "$mode" = "push" ] && ! git merge-base --is-ancestor "$base" HEAD; then
  echo "Base $base is not an ancestor of HEAD (history rewritten?); cannot check migrations." >&2
  exit 1
fi

# --no-renames reports a rename as delete + add, so the deleted name is caught.
changed="$(git diff --no-renames --name-status "$base"...HEAD -- packages/db/migrations \
  | awk -F'\t' '$1 != "A" { print $2 }')"

if [ -n "$changed" ]; then
  echo "Merged migrations must not change; add a new migration instead:" >&2
  echo "$changed" | sed 's/^/  /' >&2
  exit 1
fi
