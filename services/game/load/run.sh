#!/usr/bin/env bash
# P3-W18-S01 (Q-P3-19): seed N fastest-finger matches, play them with k6, clean up.
# Usage: GAME_TICKET_SECRET=<the local server's> services/game/load/run.sh <matches>   (a game server on PORT, default 8090)
# Writes and removes only load-* keys, and removes the run's ids from the game:results
# lists. Run it with the Python worker (consume) stopped: it would take load ids as results.
set -euo pipefail
n="${1:?number of matches}"
[[ $n =~ ^[1-9][0-9]*$ ]] || { echo "matches must be a positive number" >&2; exit 2; }
: "${GAME_TICKET_SECRET:?GAME_TICKET_SECRET (the one the local game server was started with)}"
here="$(cd "$(dirname "$0")" && pwd)"
cd "$here/../../.."
# Each run has its own ids: the server keeps an ended match ended for an hour.
run="$(date +%s)"
# valkey-cli exits 0 on a failed command: show anything that isn't a plain success.
cli() { docker compose exec -T valkey valkey-cli "$@" | { grep -v -e '^OK$' -e '^(integer)' -e '^[0-9]*$' >&2 || true; }; }

rounds=""
for q in 1 2 3 4 5 6 7; do
  rounds+="{\"question\":$q,\"stem\":\"Load question $q?\",\"options\":[\"right\",\"w1\",\"w2\",\"w3\"],\"correct\":0},"
done
rounds="[${rounds%,}]"

cleanup() {
  for i in $(seq 1 "$n"); do
    printf 'DEL game:match:load-%s-%d game:snap:load-%s-%d game:result:load-%s-%d\nLREM game:results 0 load-%s-%d\nLREM game:results:working 0 load-%s-%d\nLREM game:results:refused 0 load-%s-%d\n' "$run" "$i" "$run" "$i" "$run" "$i" "$run" "$i" "$run" "$i" "$run" "$i"
  done | cli
}
trap cleanup EXIT

for i in $(seq 1 "$n"); do
  printf "SET game:match:load-%s-%d '{\"players\":[\"load-%s-%d-a\",\"load-%s-%d-b\"],\"mode\":\"fastest_finger\",\"rounds\":%s}' EX 3600\n" "$run" "$i" "$run" "$i" "$run" "$i" "$rounds"
done | cli

k6 run -e RUN="$run" -e MATCHES="$n" -e PORT="${PORT:-8090}" "$here/matches.js"
