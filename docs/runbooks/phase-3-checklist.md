# Phase 3 checklist (P3-W18-S04)

Checked locally on 2026-11-07 at commit c1d3483, before anything is deployed (ADR-0013). Each row says what to do, what should happen, and how it was checked. The automated suite (`pnpm check`, 28 tasks: web 1414, Python 1361, Go game server and CLI, infra 89) covers every row.

**Not walked in a browser this time.** Claude in Chrome is off by the owner's rule and the dev server (3100) wasn't running, so no row was clicked through by hand. Rows marked **owner to walk** need a person in a browser before the phase counts as walked. Everything else was checked by tests or local runs, as each row says.

## Phase 3 "Done when" (docs/roadmap/phase-3.md)

| Metric                                              | Query                                     | Fixture test                    | Local events                                                     |
| --------------------------------------------------- | ----------------------------------------- | ------------------------------- | ---------------------------------------------------------------- |
| ≥40% of daily actives play the daily challenge      | `packages/events/queries/daily_share.sql` | `test_metric_queries.py` passes | runs: 3 days with 1 active user, 0 daily players                 |
| Half of matches start within 10 s (strict, Q-P3-29) | `match_start.sql`                         | passes                          | runs: no `match_found` in the local files                        |
| Players return more often than non-players          | `player_return.sql`                       | passes                          | runs: 7 non-players, 1 returned; no players in the cohort window |
| ≥20% of missed concepts lead to reading within 48 h | `missed_read.sql`                         | passes                          | runs: no `concept_missed` yet (the event is new in W18-S03)      |

The local event files run from 2026-10-26 to 2026-11-02 (3,624 events), so they predate most of Phase 3's events. The numbers only show that the queries run on real event files (DuckDB, the test's macro), not whether the targets are met. That needs beta traffic after deploy. All four are named queries in the AWS stack.

## Features, Weeks 13–18

| Week | Feature                                                           | Do                                              | Expect                                                                                                        | Checked                                                                                            |
| ---- | ----------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| W13  | Play tab, solo sprint, estimation (hand-written and generated)    | Play → each game                                | Four games with format and win condition; server-timed rounds; misses linked to reading (Read again)          | tests; `/play` 200 in the VM smoke run; **owner to walk**                                          |
| W13  | Daily challenge, share cards                                      | Play → Daily challenge; share link              | One attempt a day, streak with freezes, `/admin/daily` approval; a share page with dots, no answers           | tests (one date-dependent streak test is flaky, see below); **owner to walk**                      |
| W13  | Guest to account merge                                            | Play as a guest, then sign in                   | Games, ratings, flags and runs move to the account                                                            | tests (kysely-guest-merge, incl. fair-play flags)                                                  |
| W14  | Boards: store, country, university, friends, Play boards          | Play → Boards; Profile country and university   | Weekly and season boards by scope; universities by average rating; follow by username                         | tests; **owner to walk**                                                                           |
| W15  | Game server: tickets, actor, snapshots and reconnects, results    | Run the Go server; join with a ticket           | One actor per match; a restart resumes from the snapshot; one result per match on `game:results`              | Go tests (race); W18-S01 load run (1,000 sockets); VM smoke: `/game/0/ws` 401 without a ticket     |
| W16  | Glicko-2, matchmaking, question sets, live sprint, fastest finger | Play → live sprint / fastest finger             | Paired by rating; 3 s countdown; sprint by own pace; fastest finger by first right answer; rating on Play     | tests (worker rating, queue, game server); k6 played 500 fastest-finger matches; **owner to walk** |
| W16  | Monthly seasons                                                   | Boards → Season                                 | This month's board live; a closed month frozen; soft reset                                                    | tests (season close, boards)                                                                       |
| W17  | Ghosts, then labeled bots after 10 s                              | Queue alone; or Play bot now                    | Countdown, then a match labeled "Ghost · ~N" or "Bot · ~N"; half-weight rating                                | tests; **owner to walk**                                                                           |
| W17  | Friend challenge links                                            | Play → Challenge a friend                       | A 10-minute link for one friend; Join now on the sender's tab; unrated                                        | tests; **owner to walk**                                                                           |
| W17  | Agent hook API, CLI, web push                                     | Profile → Agent hook; `interval start` / `stop` | Device token shown once; elapsed time on Home; the place saved; a 45 s nudge (CLI notification, and web push) | tests (API, Go CLI, RFC 8291 vector); **owner to check** a real push with `pnpm push:keys` keys    |
| W18  | WebSocket load test                                               | `services/game/load/run.sh 500`                 | Every match completes, answer p99 4 ms                                                                        | run (docs/load/phase-3-websocket.md)                                                               |
| W18  | Fair-play signals                                                 | `/admin/fair-play` (owner)                      | Flags with their signals; Dismiss or Remove the gain; Play shows the adjustment; a line on the live screen    | tests (Go, worker, admin, Play); **owner to walk**                                                 |
| W18  | Phase 3 metrics                                                   | Run the queries                                 | Rows per day, opponent, cohort and game                                                                       | DuckDB tests; local run above                                                                      |

## Deployment modes

| Check                                                                                                                                                                                                                                                                                                                                        | Result                                                                                                                                                                                                                                                                                                                                                   |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm --filter @interval/infra synth`                                                                                                                                                                                                                                                                                                        | both stacks (`interval-prod`, `interval-prod-aws`) synthesized; warnings only (ECS minHealthyPercent, one feature flag)                                                                                                                                                                                                                                  |
| VM smoke run: `write-env.sh` with a stub `AWS_CLI` printing random secrets (no AWS called), `ENV_DIR`, `PGDATA_DIR`, `VALKEY_DIR`, `FILES_DIR` and `INTERVAL_ETC` (with `files-backend` = `local-s3`) in a temp dir, `HTTP_PORT=8080`; `docker compose -p interval-smoke -f deploy/compose.prod.yml --profile local-s3 up -d --build --wait` | every service healthy, including the game server (caddy, web, worker, game, postgres, valkey, seaweedfs, ocr); migrations exited 0. Through Caddy: `/api/health` 200, `/` 307 to `/join` (200), `/play` 200, `/game/0/ws` 401 "ticket refused: malformed" (it reaches the game server), `/game/1/ws` 404 (another server's id). Torn down with `down -v` |

The local smoke run needs `INTERVAL_ETC` pointed at a temp dir holding `files-backend`; otherwise `write-env.sh` reads the VM's `/var/lib/interval/pgdata/etc`. docs/runbooks/vm.md doesn't list it (nor `FILES_DIR`, as the Phase 2 checklist noted).

## Seen while checking (not fixed here)

- The quizzes test "a shared result keeps the streak it had on its day" failed on 2026-11-05 with or without the day's changes, and passed on 2026-11-07: it depends on the date.
- Under the full check's load, a DB-backed web test (better-auth, kysely-checkpoints) or the infra synth hook sometimes times out; each passes on its own.
- The local event files end on 2026-11-02: nothing has run the dev app since, so no Phase 3 W16–W18 events exist locally.
- The drift audit's findings: docs/audits/2026-11-07.md.

## Walking the "owner to walk" rows

An attempt with Claude in Chrome on 2026-11-08 stalled: the machine had about 65 MB of free memory, a page took 5.8 minutes to compile, and the database connection timed out. Walk these when the machine is less loaded.

### Setup (live matches need a proxy: the dev server doesn't route `/game/*`)

1. Make a ticket secret for this session: `openssl rand -hex 32` (any 32+ characters; `.env` can hold it as `GAME_TICKET_SECRET`).
2. Game server: `cd services/game && GAME_SERVER_ID=0 PORT=8090 VALKEY_URL=redis://127.0.0.1:6379 GAME_TICKET_SECRET=<secret> go run .`
3. A proxy on 3300 (Caddy is installed). Save this as a Caddyfile and run `caddy run --config <file> --adapter caddyfile`:

   ```
   { admin off
     auto_https off }
   http://localhost:3300 {
     handle /game/* { reverse_proxy localhost:8090 }
     handle { reverse_proxy localhost:3100 }
   }
   ```

4. Web: `scripts/with-env.sh env BETTER_AUTH_URL=http://localhost:3300 GAME_TICKET_SECRET=<secret> pnpm --filter @interval/web dev`, then open http://localhost:3300.
5. Results, ratings and fair-play flags need the worker's `consume`, which also runs AI stages within the budget. Run it only if that's fine; without it, matches play but their results aren't recorded.

### Steps

| Row                          | Do                                                                                                                     | Expect                                                                                                                                                                |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Play tab                     | Open Play                                                                                                              | Four games, each with its format and win condition; Rating, Season board, Boards, Challenge a friend                                                                  |
| Solo sprint                  | Play → Sprint → answer a few, miss one                                                                                 | Server-timed 60 s; results with "Read again" linking the missed section                                                                                               |
| Estimation                   | Play → Estimation round                                                                                                | A guess per question; points out of 100 each; a reveal citing the source                                                                                              |
| Daily challenge              | Play → Daily challenge; then open the share link in a private window                                                   | One attempt today; streak shown; the share page shows dots, no answers                                                                                                |
| Boards                       | Play → Boards; switch scope (global, country, university, friends) and Season                                          | Your score on each board you have; universities ranked by average rating                                                                                              |
| Live sprint / fastest finger | Play → Sprint live (second account in a private window for a person; or alone)                                         | A 3 s countdown; alone, after 10 s "vs Bot · ~N: not a live player" (or a ghost); the line "Leaving this tab during a round is noted for fair play." during the match |
| Play bot now                 | Queue, then press Play bot now before 10 s                                                                             | A ghost or bot match at once                                                                                                                                          |
| Friend challenge             | Play → Challenge a friend → copy the link; open it in a private window signed in as a second account                   | Join now appears on the sender's tab; an unrated match                                                                                                                |
| Fair play                    | Switch tabs during a live round a few times; with `consume` running, open `/admin/fair-play`                           | A flag with its signals; Dismiss / Remove the gain; after Remove, Play shows "Fair-play adjustment"                                                                   |
| Agent hook                   | Profile → Agent hook → Add a device; run `cli/interval` with the token (`interval login`, `interval start`, wait 45 s) | The token shown once; a desktop notification after 45 s; Home shows elapsed time                                                                                      |
| Web push                     | `pnpm push:keys`, put the keys in `.env`; Profile → Notify me on this device; start an agent task                      | A browser notification after 45 s                                                                                                                                     |
