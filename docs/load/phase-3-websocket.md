# Phase 3 WebSocket load test (P3-W18-S01)

- IDs: LOAD-2 (one process owns each match), LOAD-4, Q-P3-19.
- Run date: 2026-11-04.
- Owner's scope (Q-P3-19): 50, 200 and 500 concurrent fastest-finger matches, local only, findings here (no issues, no fixes).

## Setup

- **Machine:** Apple M3 (8 cores), 8 GB of memory, macOS. k6 and the game server ran on the same laptop over loopback, so the numbers carry k6's own cost too. They are a ceiling on what the server adds, not a production figure: there's no TLS, no ALB and no CloudFront, and the network has no distance.
- **Game server:** `services/game` built with `go build` and run as one process with `GAME_SERVER_ID=0` and `PORT=8090`. It used the compose Valkey and a throwaway ticket secret, the same one given to k6.
- **Load:** k6 v2.3.0 running `services/game/load/matches.js`, launched by `services/game/load/run.sh <matches>`.
  - The script seeds `game:match:load-<run>-<i>` (7 rounds) in Valkey, then runs one k6 VU per player, all starting together. That's a burst start, harder than real arrivals.
  - Each VU signs its own ticket and plays the whole match:
    - seat a answers right after 0.3–1.2 s;
    - seat b answers wrong after 0.2–1.0 s.
  - On exit the script deletes the run's `load-*` keys and removes its ids from `game:results`.
- **To repeat:** start the server with a secret, then run `GAME_TICKET_SECRET=<same> services/game/load/run.sh 500`. Raise `ulimit -n` above 2 × matches, plus headroom, in both the server's shell and k6's. Stop the Python worker (`consume`) first. Otherwise it takes the load ids from `game:results` as results; the script's cleanup also clears them from its working and refused lists. k6 fails the run unless every match completes with no socket error.

**What each metric means:**

| Metric | From → to |
| --- | --- |
| `match_start` | socket open → `countdown`, which is sent once both players have joined |
| `answer_locked` | a player's answer sent → that player's own `locked` broadcast (one trip through the match actor) |
| `answer_reveal` | seat a's right answer sent → `reveal` |
| `match_completed` | seat a received a `final` it won 7–0 |
| `socket_errors` | socket errors and closes before `final` |

## Results

Each match plays about 26 s: a 3 s countdown, then 7 rounds, each one's answer followed by a 3 s reveal.

| Matches (sockets) | match_start p50 / p95 / p99 | answer_locked p50 / p95 / p99 | answer_reveal p50 / p95 / p99 | ws_connecting p95 | Completed | Socket errors | Server peak RSS | Server peak CPU (% of one core) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 50 (100) | 15 / 19 / 19 ms | 1 / 3 / 8 ms | 1 / 3 / 8.5 ms | 22 ms | 100% (50/50) | 0 | 36 MB | 4.8 |
| 200 (400) | 33 / 227 / 241 ms | 0 / 2 / 4 ms | 1 / 2 / 4 ms | 46 ms | 100% (200/200) | 0 | 55 MB | 10 |
| 500 (1,000) | 72 / 236 / 280 ms | 0 / 2 / 4 ms | 0 / 2 / 4 ms | 115 ms | 100% (500/500) | 0 | 95 MB | 31 |

The latency columns come from k6. RSS and CPU were sampled with `ps` once a second.

## Findings

1. **One server process holds 500 concurrent matches with room to spare.**
   - Answer latency doesn't grow with load: p99 is 4 ms at 500 matches, against 8 ms at 50, where there are fewer samples.
   - Memory grows by about 130 KB per match, above a base of about 30 MB.
   - CPU peaked at under a third of one core.
   - Nothing here argues against LOAD-2's one-process-per-match design at this size.
2. **Match start is mostly the wait for the other seat's socket.** This is an inference: actor time isn't measured on its own.
   - At 500 matches, p99 is 280 ms and max is 304 ms. `match_start` runs from a socket's own open to the countdown, so it's mostly the wait for the partner's socket while 1,000 handshakes arrive together (ws_connecting p95 is 115 ms).
   - It's far inside Phase 3's "matches started within 10 s" (that metric also counts the queue, which this test skips).
3. **Ended match ids are refused for an hour.**
   - The first 200- and 500-match runs reused the 50-match run's ids. Those sockets were closed with "match over" (75% and 60% completed), which is `endedFor` working as designed: a ticket can't restart an ended match.
   - The script now gives every run its own ids. The web app's ids are fresh UUIDs, so this isn't a product bug.
4. **No errors and no dropped seats at any step.** The "too slow" drop path (a seat whose send buffer fills) never fired.

After the review the script was changed:
- it leaves the close to the server;
- it fails on any incomplete match or socket error;
- its cleanup covers the worker's lists.

It was rerun at 50 matches as a check (see docs/progress.md). The table above is from the run before those changes, whose client logic was otherwise the same.

## Not covered (later ideas, not planned)

- The sprint mode, whose per-player question stream is chattier than rounds.
- Reconnect storms (MATCH-6 grace) and a server restart mid-load (snapshot resume).
- More than one game server, and the queue and matchmaking in the web app.
- TLS and an ALB in the path; a separate load machine.
