#!/usr/bin/env bash
# Stop hook. Typechecks only the projects that contain changed files, using
# whatever tooling exists. Exit 2 keeps Claude working until checks pass.
# Written for bash 3.2 (macOS default).
set -euo pipefail

input=$(cat)

if command -v jq >/dev/null 2>&1; then
  active=$(printf '%s' "$input" | jq -r '.stop_hook_active // false')
elif command -v python3 >/dev/null 2>&1; then
  active=$(printf '%s' "$input" | python3 -I -c 'import json,sys; print(str(json.load(sys.stdin).get("stop_hook_active", False)).lower())')
else
  echo "typecheck-changed: neither jq nor python3 found; skipping" >&2
  exit 0
fi
# A second Stop after a blocked one: never block again, or Claude loops.
[ "$active" = "true" ] && exit 0

root=${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}
root=$(cd "$root" && pwd -P)
cd "$root"
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

if git rev-parse --verify --quiet HEAD >/dev/null; then
  tracked=$(git diff --name-only HEAD)
else
  tracked=$(git diff --name-only --cached)
fi
changed=$(printf '%s\n%s\n' "$tracked" "$(git ls-files --others --exclude-standard)" | sed '/^$/d' | sort -u)
[ -n "$changed" ] || exit 0

# Prints the nearest directory at or above $1 (repo-relative) containing $2.
# Deleted files still resolve through their nearest existing ancestor.
find_up() {
  dir="$root/$(dirname "$1")"
  while [ ! -d "$dir" ]; do dir=$(dirname "$dir"); done
  while :; do
    if [ -e "$dir/$2" ]; then
      printf '%s\n' "$dir"
      return 0
    fi
    [ "$dir" = "$root" ] && return 1
    dir=$(dirname "$dir")
  done
}

ts_projects=""
py_projects=""
go_modules=""
while IFS= read -r f; do
  case "/$f" in */node_modules/* | */.venv/* | */cdk.out/* | /docs/_source/*) continue ;; esac
  case $f in
    *.ts | *.tsx) d=$(find_up "$f" tsconfig.json) && ts_projects="$ts_projects$d"$'\n' ;;
    *.py) d=$(find_up "$f" pyproject.toml) && py_projects="$py_projects$d"$'\n' ;;
    *.go) d=$(find_up "$f" go.mod) && go_modules="$go_modules$d"$'\n' ;;
  esac
done <<EOF
$changed
EOF

failures=""
record() { failures="${failures}== $1 =="$'\n'"$(printf '%s\n' "$2" | tail -n 30)"$'\n'; }

while IFS= read -r d; do
  [ -n "$d" ] || continue
  tsc=""
  probe="$d"
  while :; do
    if [ -x "$probe/node_modules/.bin/tsc" ]; then tsc="$probe/node_modules/.bin/tsc"; break; fi
    [ "$probe" = "$root" ] && break
    probe=$(dirname "$probe")
  done
  [ -n "$tsc" ] || continue
  if ! out=$("$tsc" --noEmit -p "$d" 2>&1); then record "tsc ${d#"$root"/}" "$out"; fi
done <<EOF
$(printf '%s' "$ts_projects" | sort -u)
EOF

if command -v uv >/dev/null 2>&1; then
  while IFS= read -r d; do
    [ -n "$d" ] || continue
    if ! out=$(uv run --project "$d" pyright 2>&1); then record "pyright ${d#"$root"/}" "$out"; fi
  done <<EOF
$(printf '%s' "$py_projects" | sort -u)
EOF
fi

if command -v go >/dev/null 2>&1; then
  while IFS= read -r d; do
    [ -n "$d" ] || continue
    if ! out=$(cd "$d" && go build ./... 2>&1 && go vet ./... 2>&1); then record "go ${d#"$root"/}" "$out"; fi
  done <<EOF
$(printf '%s' "$go_modules" | sort -u)
EOF
fi

if [ -n "$failures" ]; then
  printf 'Typecheck failed:\n%s' "$failures" >&2
  exit 2
fi
exit 0
