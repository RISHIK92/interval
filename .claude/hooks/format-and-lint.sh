#!/usr/bin/env bash
# PostToolUse hook for Edit/Write. Formats the edited file and lints it with
# whatever repo-local tooling exists. Exit 2 sends lint errors back to Claude.
# Written for bash 3.2 (macOS default).
set -euo pipefail

input=$(cat)

if command -v jq >/dev/null 2>&1; then
  file=$(printf '%s' "$input" | jq -r '.tool_input.file_path // empty')
elif command -v python3 >/dev/null 2>&1; then
  file=$(printf '%s' "$input" | python3 -I -c 'import json,sys; print((json.load(sys.stdin).get("tool_input") or {}).get("file_path") or "")')
else
  echo "format-and-lint: neither jq nor python3 found; skipping" >&2
  exit 0
fi
[ -n "$file" ] || exit 0

root=${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}
root=$(cd "$root" && pwd -P)
case $file in /*) ;; *) file="$root/$file" ;; esac
[ -f "$file" ] || exit 0
file="$(cd "$(dirname "$file")" && pwd -P)/$(basename "$file")"

case $file in "$root"/*) ;; *) exit 0 ;; esac
rel=${file#"$root"/}
case "/$rel" in
  /docs/_source/* | */node_modules/* | */.venv/* | */cdk.out/*) exit 0 ;;
esac

# Walks up from the file's directory to the repo root; prints the first
# directory containing $1.
find_up() {
  dir=$(dirname "$file")
  while :; do
    if [ -e "$dir/$1" ]; then
      printf '%s\n' "$dir"
      return 0
    fi
    [ "$dir" = "$root" ] && return 1
    dir=$(dirname "$dir")
  done
}

bin_for() {
  d=$(find_up "node_modules/.bin/$1") || return 1
  printf '%s\n' "$d/node_modules/.bin/$1"
}

errors=""
add_error() { errors="${errors}$1"$'\n'; }

run_prettier() {
  p=$(bin_for prettier) || return 0
  if ! out=$("$p" --write --log-level warn "$file" 2>&1); then
    add_error "prettier: $out"
  fi
}

case $file in
  *.ts | *.tsx | *.js | *.mjs)
    run_prettier
    if e=$(bin_for eslint); then
      if ! out=$("$e" --no-warn-ignored "$file" 2>&1); then
        add_error "$out"
      fi
    fi
    ;;
  *.py)
    if proj=$(find_up pyproject.toml) && command -v uv >/dev/null 2>&1; then
      uv run --project "$proj" ruff format --quiet "$file" >/dev/null 2>&1 || true
      if ! out=$(uv run --project "$proj" ruff check --quiet "$file" 2>&1); then
        add_error "$out"
      fi
    fi
    ;;
  *.go)
    if find_up go.mod >/dev/null && command -v gofmt >/dev/null 2>&1; then
      if ! out=$(gofmt -l -w "$file" 2>&1 >/dev/null); then
        add_error "$out"
      elif ! out=$(cd "$(dirname "$file")" && go vet . 2>&1); then
        add_error "$out"
      fi
    fi
    ;;
  *.md | *.json | *.yml | *.yaml)
    # Docs copied verbatim from the blueprint must not be reformatted.
    case $rel in
      docs/product.md | docs/decisions.md | docs/open-decisions.md | \
        docs/roadmap/overview.md | docs/roadmap/phase-[0-9].md | docs/roadmap/phase-4.5.md) ;;
      *) run_prettier ;;
    esac
    ;;
esac

if [ -n "$errors" ]; then
  printf 'Lint failed for %s:\n%s' "$rel" "$errors" | head -n 40 >&2
  exit 2
fi
exit 0
