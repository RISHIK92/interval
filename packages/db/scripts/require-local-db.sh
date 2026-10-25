#!/usr/bin/env bash
# Sourced by the DB scripts: refuse any server but a local one, unless CI=true.
# CLAUDE.md: never migrate a non-local database.
require_local_db() {
  local rest host
  # libpq lets ?host= / ?hostaddr= override the URL's host; refuse them outright.
  case "$1" in
    *[?\&]host=* | *[?\&]hostaddr=*)
      echo "Refusing DATABASE_URL with host or hostaddr query parameters." >&2
      exit 1
      ;;
  esac
  rest="${1#*://}"
  rest="${rest#*@}"
  case "$rest" in
    \[*) host="${rest%%]*}]" ;;
    *) host="${rest%%[:/?]*}" ;;
  esac
  case "$host" in
    localhost | 127.0.0.1 | '[::1]') return 0 ;;
  esac
  if [ "${CI:-}" = "true" ]; then
    return 0
  fi
  echo "Refusing to touch database host '$host': only localhost is allowed outside CI." >&2
  exit 1
}
