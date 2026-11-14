# A window start under load (LOAD-4, P5-W34-S02)

The goal (Phase 5's "done when"): at a ranked window's start, 95% of submissions get their verdict within 10 seconds. The test plays a window's start on the local stack. Every player of a set of prepared battles connects to game server 0 at once and Submits the problem's Python reference. k6 measures the time from sending the code to its verdict.

## What it needs

- **k6:** `brew install k6`. It's the owner's tool (Q-P5-21), not a repo dependency.
- **The local stack:** `docker compose up -d --wait`, then `pnpm db:migrate`, then `pnpm problems:load`. The problems' private files must be in the bucket.
- **The game server** (`services/game`) on port 8080, with `VELOX_URL` and `VELOX_API_KEY` in `.env`.
- **Velox** running, with that key's ID in Velox's `JUDGE_API_KEY_IDS`.

## Run it

```sh
# 1. The battles: N local test players, 4 to a room, on one problem (unrated).
pnpm load:prepare lru-cache 200 /tmp/battles.json

# 2. Within a minute or so (the battles' clocks start when their players arrive):
scripts/with-env.sh k6 run -e BATTLES=/tmp/battles.json scripts/load/window-start.js
```

`GAME_URL` (default `ws://localhost:8080`) points the script at another game server.

## Reading it

- **`verdict_ms`:** the time from sending the code to its verdict. The threshold is `p(95)<10000`.
- **`verdicts_failed`:** a judge error, a refusal, or no verdict within 2 minutes. The threshold is `count==0`.

k6 exits non-zero when either threshold fails.

Record each run in progress.md: the date, the players, p95, p99, failures, and where Velox ran (its workers and host).

## Cleaning up

The test players are `load-<run>-<n>` with `@load.example.test` emails, on one invite code (`LOAD<run>`). Their battles are unrated, so no rating moves. To remove a run from the local database: `delete from app_user where id like 'load-%'`. Their matches' players and snapshots cascade.
