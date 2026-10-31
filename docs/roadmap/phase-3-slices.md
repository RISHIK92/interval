# Phase 3 slices

DRAFT (2026-10-31), updated with the owner's answers to docs/questions/phase-3.md the same day. Phase 3 (docs/roadmap/phase-3.md) as one-session slices, in the Phase 1 and 2 format. Run a slice with `/slice <ID>`.

Field key: **IDs** = decision IDs implemented. **Needs** = slices and ADRs that must be done or ACCEPTED first. **Q** = questions in docs/questions/phase-3.md.

Already in place, so not sliced again:

- **Week 13's ElastiCache.** ADR-0011 moved Redis into Phase 1; ADR-0014 runs Valkey in every mode (ElastiCache Valkey in the AWS stack, Valkey in VM compose and local dev). Phase 3 only adds real-time state to it (W14-S01, W16-S02).
- **The question bank** (Q-1, Q-2, Q-3; P2 Weeks 8–9): generator, validator, spot checks, difficulty recalibration. Quick games draw from it.
- **Quiz attempts and mastery evidence** (P2 Week 9, Test 60s): the solo games reuse them.

First to slip into a Phase 3.5 (roadmap): friends leaderboards (W14-S05) and 1v1 estimation (never sliced here).

ADRs the answers need, each before its first slice (PROPOSED until the owner accepts):

- ~~guests revived for Play~~ ADR-0029, ACCEPTED 2026-10-31;
- the daily challenge auto-publishes an unreviewed set (Q-P3-06; amends Q-2) — before W13-S05;
- university picked from a list, unverified (Q-P3-09; amends §6.7 "verified" and the Week 14 roadmap) — before W14-S03;
- the game server's shape and match tickets (Q-P3-01) — before W15-S01;
- ratings in the Python worker (Q-P3-02; amends MATCH-1) — before W16-S01;
- the agent CLI in Go (Q-P3-17; extends ARCH-2) — before W17-S05.

## Week 13: the Play tab, solo games, the daily challenge

### P3-W13-S01 The Play tab

- IDs: §6.1, §6.3, ADR-0017, OPS-3
- Needs: ADR-0029 (ACCEPTED)
- Goal: Play turns from "Coming later" into a tab that lists the quick games, each with a one-line format and win condition; live games (W16) show "Coming later" until built.
- Acceptance: the tab bar's Play is a link (ADR-0017 updated by a short ADR or noted as its planned change); a Play page with Daily challenge, 60-second sprint, Estimation, Fastest finger; an entitlement check per game (OPS-3); page tests; guests play everything, boards and live games included, and their games, ratings and streak merge into the account at sign-up (Q-P3-03), with ADR-0029's anti-farming limits.
- Out of scope: leagues (quick games are human-only, §6.2, C-29), battles.
- Q: Q-P3-03.

### P3-W13-S02 Solo 60-second sprint

- IDs: §6.3, §6.1, MATCH-4, PER-2, DB-5
- Needs: S01
- Goal: a solo sprint: as many live questions as the player can answer correctly in 60 seconds, from their concepts, at their level; the result sends missed concepts back to reading.
- Acceptance: built on the quiz attempt (P2-W9); server-side timing (the server's clock decides what counts); questions chosen by concept and difficulty (Q-3's calibrated values); missed concepts link to readings (§6.1); answers count as mastery evidence like a quiz; `game_started`/`game_finished` events with ids and score only; tests on the selection and the timing rule.
- Out of scope: 1v1 (W16), leaderboards (W14).
- Q: Q-P3-04.

### P3-W13-S03 Estimation questions

- IDs: §6.3, Q-1, Q-2, AI-3, ADR-0006 C-27
- Needs: none
- Goal: a numeric question type ("how many…", with a unit) and its scoring: full points within 1.25×, falling linearly in log space to 0 at 10× off (C-27).
- Acceptance: migration for the numeric answer and unit, with generated types; a pure scoring function tested at 1×, 1.25×, 3×, 10× and beyond, both directions; the question source per Q-P3-05; admin review the same as multiple choice.
- Out of scope: the game itself (S04); generated estimation questions (S03b, split by the owner on 2026-10-31).
- Q: Q-P3-05.

### P3-W13-S03b Generated estimation questions

- IDs: §6.3, Q-1, AI-3, Q-P3-05
- Needs: S03
- Goal: the question generator also drafts an estimation question where a moment states the number, cited and validated like multiple choice (Q-1), through the batch path.
- Acceptance: drafting a moment's estimate doesn't retire its multiple-choice questions (and the reverse); the validator answers the number blind and agrees within 1.25× (C-27's full points); the citation contains the number; batches carry both kinds; the AI budget (OPS-4) holds. S03's `question_shape` keeps `validator_answer` null for an estimate, so this slice adds a numeric validator answer; the worker's `pending`, `record_verdict`, `summary` and `save` (which retires every question on a moment) assume multiple choice today. Estimation rounds (S04) serve hand-written estimates only (`LIVE_ESTIMATE`); a moment's estimate joins them once its reveal and Read again are rights-gated (ING-2, a broken link left out, like the sprint's misses) and link through `readHref`/`outHref`.
- Out of scope: hand-written questions (S03).
- Q: Q-P3-05. Split from S03 by the owner (2026-10-31).

### P3-W13-S04 Solo estimation

- IDs: §6.3, §6.1
- Needs: S01, S03
- Goal: a solo estimation round: a set of numeric questions, each answered with a number, scored by C-27, with the real answer and its source after each.
- Acceptance: the attempt reuses S02's game shell; the reveal cites the source passage (AI-3) or the hand-written source; missed concepts go back to reading; tests on the round and the score total.
- Out of scope: 1v1 estimation (Phase 3.5).
- Q: Q-P3-05.

### P3-W13-S05 The daily challenge

- IDs: §6.3, Q-2, LOAD-4, CACHE-4, DB-5
- Needs: S02
- Goal: one set per day, the same for everyone, reviewed by the owner the day before; one attempt per user; score and streak.
- Acceptance: a worker job picks tomorrow's set (and queues it for review); `/admin/daily` shows it for approval and swaps a question; an unreviewed set auto-publishes at the day's start (Q-P3-06, its ADR) and the owner is told; one attempt enforced by a unique key (LOAD-5); the streak counts consecutive UTC days played, with a freeze earned every 7 days played covering one missed day (Q-P3-07); the day boundary per Q-P3-06; the feed shows the challenge card (§6.1); events.
- Out of scope: the share card (S06), boards (W14).
- Q: Q-P3-06, Q-P3-07.

### P3-W13-S06 Share cards

- IDs: §6.3
- Needs: S05
- Goal: a daily challenge result shares as an image that shows score and streak and never reveals a question.
- Acceptance: the image route uses Next's built-in `next/og` (no new dependency); a public share URL with the image as its preview; a test that no question text is in the image's inputs.
- Out of scope: sharing sprint results.
- Q: Q-P3-07.

### P3-W13-S07 Guest to account merge, for Play

- IDs: ADR-0029, ADR-0004, Q-P1-11, Q-P1-24, PER-2
- Needs: S01, S02
- Goal: when a guest signs up, their Play data becomes the account's: games, answers (and so mastery evidence), ratings, streaks and freezes, board entries.
- Acceptance: the merge in one transaction, idempotent if retried; conflicts per ADR-0029's open question; the account reuses the guest's invite code and group (Q-P1-24); the guest row is gone afterwards; anti-farming rules tested (one guest per browser, guest creation rate-limited per IP, no guest paired with an account from the same browser); tests against Postgres.
- Out of scope: merging reading history outside Play (P1-W1-S12's full scope).
- Q: ADR-0029's open questions.

## Week 14: leaderboards

### P3-W14-S01 Leaderboard store

- IDs: CACHE-3, CACHE-2, ADR-0012, ADR-0014
- Needs: W13-S05
- Goal: boards live in Valkey sorted sets, with Postgres snapshots as the source of truth; a board can be rebuilt from Postgres.
- Acceptance: a `Leaderboards` port, Valkey adapter and in-memory fake with a shared contract suite; daily boards for the challenge and weekly boards for sprints (§6.7); a rebuild command; scores written after a game finishes, idempotent per attempt.
- Out of scope: season rating boards (W16), the UI (S06).
- Q: none.

### P3-W14-S02 Country

- IDs: §6.7
- Needs: S01
- Goal: a player's country, and country boards.
- Acceptance: the country set as Q-P3-08 says; boards per country; Profile shows and changes it; tests.
- Q: Q-P3-08.

### P3-W14-S03 University

- IDs: §6.7
- Needs: the university ADR (Q-P3-09)
- Goal: a player picks their university from a list, or types a name that isn't there; admin unifies typed names with listed ones.
- Acceptance: the list from a public source whose licence is checked first (Hipo's university-domains-list is a candidate), kept in the repo; Profile picks and changes it; `/admin/universities` merges typed names; no email and no verification (Q-P3-09).
- Out of scope: University Cups (battles, later phases).
- Q: Q-P3-09.

### P3-W14-S04 University boards

- IDs: §6.7, ADR-0006 C-17
- Needs: S01, S03
- Goal: players see their university's board, and universities are ranked by the average rating of their members (C-17; unverified per Q-P3-09).
- Acceptance: until ratings exist (W16), universities are ranked by members' average challenge score; no minimum size (Q-P3-10); tests on the aggregation, including a university with one member.
- Q: Q-P3-10.

### P3-W14-S05 Friends (first to slip)

- IDs: §6.7
- Needs: S01
- Goal: a player follows others by username (one way, no accept, Q-P3-11), and sees a board of the people they follow.
- Acceptance: public usernames and a people search (rules open in Q-P3-11); follow and unfollow; the board.
- Q: Q-P3-11.

### P3-W14-S06 Boards on Play

- IDs: §6.7
- Needs: S01, S02, S04
- Goal: Play shows the boards: global, country, university, friends; daily, weekly; the player's own rank always visible.
- Acceptance: page tests; checked in the browser, light and dark.

## Week 15: the Go game server

### P3-W15-S01 Game server skeleton and its ADR

- IDs: ARCH-1, ARCH-2, LOAD-2, ADR-0011, ADR-0013
- Needs: an ACCEPTED ADR for the game server's shape in both modes (Q-P3-01)
- Goal: a Go module for the game server that builds, tests and runs locally, in VM compose and in the AWS stack's synth.
- Acceptance: gofmt, vet and tests in `pnpm check` and CI; a Dockerfile; a health endpoint; compose service; CDK synth with an ALB WebSocket target; config from env only (ADR-0011).
- Out of scope: matches (S03).
- Q: Q-P3-01.

### P3-W15-S02 Joining a match

- IDs: LOAD-2, OPS-1
- Needs: S01
- Goal: the web app issues a short-lived signed match ticket; the browser opens a WebSocket to the game server with it.
- Acceptance: tickets signed with a shared secret from env, expiring in seconds, single use; the Go server never reads the auth database; a bad, used or expired ticket is refused; tests on both sides.
- Q: Q-P3-01.

### P3-W15-S03 Match actor and round engine

- IDs: LOAD-2, MATCH-5
- Needs: S02
- Goal: one actor owns each match: it sends each round's question without its key, takes answers, and scores rounds on the server's clock, compensated by half the measured round-trip time, capped at 150 ms (MATCH-5).
- Acceptance: the actor is a single goroutine owning its state; RTT measured by ping; table tests on the compensation and the cap; no panics in request paths.
- Q: none.

### P3-W15-S04 Snapshots and reconnects

- IDs: LOAD-2, MATCH-6, LOAD-5
- Needs: S03
- Goal: a snapshot after every round; a dropped player has 10 seconds to reconnect (MATCH-6); a match survives its server restarting from the last snapshot.
- Acceptance: snapshots in Valkey; abandon after the grace period, with the penalty per Q-P3-12; a restart test.
- Q: Q-P3-12.

### P3-W15-S05 Results

- IDs: §6.1, PER-2, DB-5, LOAD-5
- Needs: S03
- Goal: a finished match writes its result once and queues the rating update; missed concepts go back to reading, and answers count as mastery evidence.
- Acceptance: one write per match id (idempotent); a queue message validated on both sides (ADR-0010 schemas); events.

## Week 16: matchmaking, ratings, live games

### P3-W16-S01 Glicko-2 ratings

- IDs: MATCH-1, MATCH-2
- Needs: W15-S05, Q-P3-02 answered
- Goal: one shared quick-game rating per player (MATCH-2), updated after each 1v1 by Glicko-2 in a worker (MATCH-1).
- Acceptance: migration for ratings and their history; the update tested against Glickman's worked example; the worker per Q-P3-02; season boards on the leaderboard store.
- Out of scope: OpenSkill (rooms are battles, later), seasons (S06).
- Q: Q-P3-02, Q-P3-13.

### P3-W16-S02 Matchmaking

- IDs: MATCH-3, CACHE-2, LOAD-3
- Needs: S01
- Goal: a Valkey queue that pairs players within a rating band that widens while they wait, grouped by region (MATCH-3); a pair gets a match on the game server.
- Acceptance: a `Matchmaking` port, Valkey adapter and fake; band widening tested with a fake clock; regions per Q-P3-14; time to match recorded (Phase 3 "Done when").
- Q: Q-P3-14.

### P3-W16-S03 Question sets for two

- IDs: MATCH-4, Q-3
- Needs: S02
- Goal: a match's questions come from concepts both players share, at a difficulty matched to their average rating (MATCH-4).
- Acceptance: a pure selection tested on overlap, no overlap (fallback per Q-P3-15) and a thin bank.
- Q: Q-P3-15.

### P3-W16-S04 Live 1v1 sprint

- IDs: §6.3
- Needs: S02, S03
- Goal: two players, 60 seconds, most correct wins.
- Acceptance: the game mode on the round engine; the Play screen: queue, countdown, match, result; rating and boards update.

### P3-W16-S05 Live fastest finger

- IDs: §6.3
- Needs: S04
- Goal: 1v1, 7 rounds; the first correct answer takes each round.
- Acceptance: ties broken by compensated time (MATCH-5); tests on the round rules.

### P3-W16-S06 Monthly seasons

- IDs: §6.6, §6.7
- Needs: S01
- Goal: quick-game ratings run in monthly seasons (Q-P3-13): season boards, and a soft reset toward the mean when a season ends.
- Acceptance: the reset as a pure function with tests; a job closes the season on the 1st (UTC) and keeps the final board; Play shows the current season's board.
- Q: Q-P3-13.

## Week 17: ghosts, bots, challenges, the agent hook

### P3-W17-S01 Ghosts

- IDs: BOT-1, BOT-3, BOT-4
- Needs: W16-S04
- Goal: every run is recorded (answers and their times) and can be replayed as a labeled ghost opponent; ratings move half as much against a ghost.
- Acceptance: recordings keep ids and timings only; "Ghost" always on screen (BOT-3); half-weight updates tested (BOT-4).

### P3-W17-S02 Fallback after 10 seconds, then labeled bots

- IDs: BOT-1, BOT-2, BOT-3, BOT-4, ADR-0006 C-01
- Needs: S01
- Goal: with no live opponent after 10 seconds (C-01), the player gets a ghost, else a synthetic bot built from question difficulty and real answer times; "Play bot now" skips the wait.
- Acceptance: the timeout and order tested with a fake clock; bots always labeled; half weight.

### P3-W17-S03 Friend challenge links

- IDs: §6.3
- Needs: S01
- Goal: a link that opens a private live match with the sender; both must be online (Q-P3-16).
- Acceptance: the link expires, and fails clearly when the sender isn't online; a guest can open it (Q-P3-03).
- Q: Q-P3-16, Q-P3-03.

### P3-W17-S04 Agent hook API

- IDs: §7, LOAD-5, DB-5, ADR-0006 C-09, C-10
- Needs: none
- Goal: endpoints that take only "started" and "finished" for a device, never prompts or code; Profile issues and revokes device tokens.
- Acceptance: zod at the boundary rejects any other field; idempotency keys (LOAD-5); tokens stored hashed; finish saves the place; the feed shows elapsed time only (C-10); events.
- Q: Q-P3-17.

### P3-W17-S05 Agent hook CLI

- IDs: §7
- Needs: S04, the agent CLI ADR (Q-P3-17)
- Goal: `interval start` and `interval stop`, and a notification about 45 seconds after start offering a quick session.
- Acceptance: a Go binary (Q-P3-17), sharing the game server's toolchain and CI; a setup note for Claude Code hooks and other agents; the CLI's own notification plus web push to the PWA (Q-P3-18; a new dependency is asked first); the CLI sends nothing but the two events (a test over its request bodies).
- Q: Q-P3-17, Q-P3-18.

## Week 18: load, fair play, launch

### P3-W18-S01 WebSocket load test

- IDs: LOAD-2, LOAD-4
- Needs: W16-S04
- Goal: a k6 script that runs many concurrent matches against the local game server and reports match start time and round latency.
- Acceptance: k6 per Q-P3-19; results recorded in docs; a finding becomes an issue, not a fix in this slice.
- Q: Q-P3-19.

### P3-W18-S02 Fair-play signals

- IDs: §6.9, ADR-0006 C-14
- Needs: W16-S04
- Goal: impossible answer speeds and focus changes are recorded as signals; flags go to an admin review queue before any penalty; penalties change ratings, never accounts.
- Acceptance: thresholds per Q-P3-20; `/admin/fair-play` reviews; no automatic penalty (test).
- Q: Q-P3-20.

### P3-W18-S03 Phase 3 metrics

- IDs: DB-5, Phase 3 "Done when"
- Needs: W13-S05, W16-S02
- Goal: queries for the four "Done when" metrics: daily challenge share of daily actives, matches started within 10 s, return rate of players vs non-players, missed concepts read within 48 hours.
- Acceptance: Athena SQL in `packages/events/queries/`, tested with DuckDB on fixture events (the Phase 2 pattern).

### P3-W18-S04 Phase 3 wrap-up

- IDs: ADR-0013
- Needs: all of the above
- Goal: Phase 3 checked end to end locally; "launch" is the checklist, not a deploy (ADR-0013).
- Acceptance: `docs/runbooks/phase-3-checklist.md` walked; both CDK stacks synth; VM smoke run with the game server; drift audit.
