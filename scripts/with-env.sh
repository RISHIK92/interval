#!/usr/bin/env bash
# Loads the repo-root .env for local runs. Variables already set (CI) take precedence.
# Accepts NAME=value lines, an optional `export ` prefix, and one pair of quotes
# around the value; anything else stops with the line number.
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
env_file="$repo_root/.env"
if [ -f "$env_file" ]; then
  n=0
  while IFS= read -r line || [ -n "$line" ]; do
    n=$((n + 1))
    line="${line%$'\r'}"
    trimmed="${line#"${line%%[![:space:]]*}"}"
    case "$trimmed" in
      '' | '#'*) continue ;;
    esac
    trimmed="${trimmed#export }"
    name="${trimmed%%=*}"
    if [ "$name" = "$trimmed" ] || ! [[ "$name" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
      echo "with-env.sh: $env_file:$n is not NAME=value" >&2
      exit 1
    fi
    value="${trimmed#*=}"
    case "$value" in
      \"*\") value="${value:1:${#value}-2}" ;;
      \'*\') value="${value:1:${#value}-2}" ;;
      *) value="${value%% #*}" ;;
    esac
    if [ -z "${!name+x}" ]; then
      export "$name=$value"
    fi
  done < "$env_file"
fi

# Web runs from apps/web and the worker from the root; a relative events folder means the
# same place for both.
if [ -n "${EVENTS_DIR:-}" ] && [ "${EVENTS_DIR#/}" = "$EVENTS_DIR" ]; then
  export EVENTS_DIR="$repo_root/$EVENTS_DIR"
fi

exec "$@"
