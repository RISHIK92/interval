# A window start under load (LOAD-4, P5-W34-S02)

The goal (Phase 5's "done when"): at a ranked window's start, 95% of submissions get their verdict within 10 seconds. The test plays a window's start on the local stack. Every player of a set of prepared battles connects to game server 0 at once and Submits the problem's Python reference. k6 measures the time from sending the code to its verdict.

## What it needs

- **k6:** `brew install k6`. It's the owner's tool (Q-P5-21), not a repo dependency.
- **The local stack:** `docker compose up -d --wait`, then `pnpm db:migrate`, then `pnpm problems:load`. The problems' private files must be in the bucket.
- **In `.env`:** `VALKEY_URL` (load:prepare reads it), `GAME_TICKET_SECRET` (at least 32 characters; k6 mints tickets with it), `VELOX_URL` and `VELOX_API_KEY`.
- **The game server** as server 0 on port 8080 (the script connects to `/game/0/ws`): `cd services/game && GAME_SERVER_ID=0 ../../scripts/with-env.sh go run .`
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

# An HLD tournament round under load (P6-W44, Q-P6-08)

The goal (Phase 6's "done when"): 95% of simulations finish within 2 seconds. The test plays a tournament round on the local stack. Every player of a prepared round autosaves their design three times and submits it at once. The web app simulates each submission on the server (ADR-0043), and k6 measures each submission's whole round trip.

## What it needs

- **k6:** `brew install k6`.
- **The local stack:** `docker compose up -d --wait`, then `pnpm db:migrate`.
- **The web app, as a production build** (`pnpm turbo build`, then `scripts/with-env.sh pnpm --filter @interval/web start --port 3100`). `next dev` compiles each route on its first request, which can take tens of seconds and would swamp the numbers. No worker is needed: the judge jobs just queue.

## Run it

```sh
# 1. N local test players, signed in, entered, checked in, and round 1 of a tournament
#    started (1v1 HLD matches on one pooled variant).
pnpm load:hld 200 /tmp/hld-round.json

# 2. Within the round's 30 minutes:
scripts/with-env.sh k6 run -e ROUND=/tmp/hld-round.json scripts/load/hld-round.js
```

`WEB_URL` (default `http://localhost:3100`) points the script at another web app.

## Reading it

- **`submit_ms`:** a submission's round trip, its simulation included. The threshold is `p(95)<2000`.
- **`autosave_ms`:** each autosave's round trip. It's not a threshold; it's for context.
- **`submits_failed`:** any submission not answered 200. The threshold is `count==0`.

Record each run in progress.md: the date, the players, p95, p99, and failures.

## Cleaning up

The output file holds live session cookies for the test players: delete it after the run. The test players are `load-hld-<run>-<n>` on one invite code (`HLDLOAD<run>`); their sessions go with them. The tournament is `Load <run>`, and its 8 variants are retired from local matchmaking until removed:

```sql
delete from hld_retired_variant r using hld_tournament_round tr, hld_tournament t
  where t.id = tr.tournament_id and t.name like 'Load %'
    and r.family = tr.family and r.seed = tr.seed and r.league = t.league;
delete from hld_tournament where name like 'Load %';
delete from hld_match m where exists (select 1 from hld_match_player p
  where p.match_id = m.id and p.user_id like 'load-hld-%');
delete from app_user where id like 'load-hld-%';
delete from invite_code where code like 'HLDLOAD%';
```

The cookie is Better Auth's over plain HTTP (`better-auth.session_token`); over HTTPS it carries a `__Secure-` prefix, which this script doesn't add.
