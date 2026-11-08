#!/usr/bin/env bash
# Writes apps/web/src/app/tokens.css from the tokens (or to $1), formatted as the web's CSS.
set -euo pipefail
pkg_dir="$(cd "$(dirname "$0")/.." && pwd)"
repo_root="$(cd "$pkg_dir/../.." && pwd)"
out="${1:-$repo_root/apps/web/src/app/tokens.css}"
node "$pkg_dir/scripts/codegen.ts" "$out"
"$repo_root/node_modules/.bin/prettier" --log-level warn --write "$out"
