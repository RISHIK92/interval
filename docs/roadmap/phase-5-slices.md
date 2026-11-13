# Phase 5 slices

DRAFT (2026-11-12, overnight). The answers to docs/questions/phase-5.md are its recommended defaults, for the owner to review. Phase 5 (docs/roadmap/phase-5.md) is LLD battles, as one-session slices in the Phase 1–4.5 format. Run a slice with `/slice <ID>`.

Field key:

- **IDs:** decision IDs implemented.
- **Needs:** slices and ADRs that must be done, or ACCEPTED, first.
- **Q:** questions in docs/questions/phase-5.md.

ADR-0039 (the engine in this repo) is PROPOSED. Slices that need it are built on its recommendation and flagged in progress.md, as the overnight rule allows.

Already in place, so not sliced again:

- **The Go game server, tickets and match actors** (Phase 3, ADR-0033): battles become a new match kind.
- **Valkey queues** (ADR-0014): the execution queue is a set of Valkey lists.
- **Opt-in push** (P4-W24-S01): window reminders are a new kind.
- **The private bucket** (DB-6): code snapshots go there.

## Week 28: the engine

### P5-W28-S01 The exec service and one sandboxed run

- IDs: EXEC-3, ARCH-1, ARCH-2
- Needs: ADR-0039 (PROPOSED)
- Goal:
  - `services/exec` (Go): `Run(language, files, stdin, limits) → {stdout, stderr, exit, timeMs, memoryKb, verdict}`, through the Docker Engine API;
  - a fresh container per run with every EXEC-3 rule (Q-P5-02);
  - Python first.
- Acceptance: unit tests on the container spec (each flag present); an integration test, skipped without Docker, runs hello world, a timeout and a memory kill.
- Q: Q-P5-01, Q-P5-02.

### P5-W28-S02 The red-team suite

- IDs: EXEC-1, EXEC-3
- Needs: S01
- Goal: an engine-agnostic Go test package (`services/exec/redteam`) with the attacks of Q-P5-03 and their expected safe verdicts, run against `services/exec`.
- Acceptance: every attack is safe on the local engine. The suite is documented for reruns (`pnpm redteam`).
- Q: Q-P5-03.

### P5-W28-S03 Five languages and compile-once

- IDs: EXEC-2, C-04
- Needs: S01
- Goal:
  - strategies for Python, JS/TS, Java, C++ and Go;
  - pinned images;
  - compile once, then every scenario in one process (EXEC-2 "Speed");
  - the red-team suite across all five.
- Q: Q-P5-04.

### P5-W28-S04 Judge0 comparison and the engine decision

- IDs: EXEC-1
- Needs: S02
- Goal:
  - a Judge0 adapter for the suite;
  - `docs/runbooks/exec-redteam.md` (how the owner runs it on a Linux host);
  - the result table, filled in for the local engine; Judge0's row is **owner to run**.

### P5-W28-S05 Execution hosts (infra)

- IDs: EXEC-5, LOAD-4, ARCH-4, ADR-0011
- Needs: S01
- Goal:
  - AWS: ECS on EC2 (not Fargate) in an isolated private subnet with no internet route, gVisor installed by user data, and images pre-pulled (Q-P5-05);
  - VM: an `exec` compose service on its own Docker network;
  - both synthesized, never deployed.

## Week 29: interfaces and harnesses

### P5-W29-S01 The interface schema

- IDs: LLDQ-1, ADR-0010
- Goal: `packages/lld` with the interface, scenario and result JSON Schemas, and generated TS and Go types, in the stale check.
- Q: Q-P5-06.

### P5-W29-S02 Starter code and harness generators

- IDs: LLDQ-1, EXEC-2
- Needs: W29-S01, W28-S03
- Goal: TS generators that emit starter code and a harness per language. The harness reads a scenario JSON from stdin, dispatches calls without reflection, and prints raw results as JSON lines.
- Acceptance: a sample interface runs end to end in all five languages.

### P5-W29-S03 The external checker

- IDs: EXEC-4, LLDQ-4
- Needs: W29-S01
- Goal: Go, outside the sandbox. It compares raw results with the recorded reference results and runs declared invariants, returning categories and pass or fail only.
- Q: Q-P5-07.

## Week 30: the problem pipeline

### P5-W30-S01 Problem files and loading

- IDs: LLDQ-1 to LLDQ-4
- Goal: the `problems/lld/<slug>/` format, its validator, and `verify`, which records the reference results and holds every language's reference to them.
- Built 2026-11-12. Loading into Postgres and the private bucket moved to W31-S01, beside the battles that first need it (ARCH-1).

### P5-W30-S02 Mutation testing and property tests

- IDs: LLDQ-2, LLDQ-3
- Goal: mutmut on each Python reference (90% killed is a test) and Hypothesis property tests; concurrency rules per language.
- Q: Q-P5-08.

### P5-W30-S02b Concurrency rules per language

- IDs: LLDQ-3, §6.5 ("threads for Java, C++, Go, and Python; interleaved async operations for JS/TS")
- Needs: W30-S02
- Goal: a problem's concurrency layer, run through harnesses that call the solution from several threads, or with interleaved async calls, by each language's rules (split from W30-S02).

### P5-W30-S03 The first three problems

- Goal: three problems, PROVISIONAL, with references in five languages, all checks passing.

### P5-W30-S04 Three more problems

- Goal: problems 4–6, as S03.

### P5-W30-S05 The judge: a service-agnostic job contract and async workers

- IDs: EXEC-2, EXEC-4, LOAD-3, LOAD-5, LLDQ-4
- Owner's request (2026-11-12): judging that any service can use, run by async workers. It was W31-S01 ("the execution queue"), brought forward and made general.
- Goal:
  - `packages/judge`: `JudgeJob` and `JudgeResult` in zod, with JSON Schema and Go generated (ADR-0040), and a TS client;
  - Valkey priority lists (ranked, rooms, casual, run), with `exec serve` workers taking the highest first;
  - jobs are idempotent and claimed atomically, re-queued when a worker dies, and stop gracefully;
  - results are kept and handed to the waiting submitter.
- Q: Q-P5-09.

### P5-W30-S06 Retire services/exec

- IDs: EXEC-1 to EXEC-5; ADR-0041 (PROPOSED)
- Owner's decision (2026-11-12): Velox runs and judges code as an independent service, and Interval uses it.
- Goal:
  - remove `services/exec`, the exec hosts in the CDK stacks, the VM's gVisor and the CI `redteam` job;
  - `pnpm contracts:velox` writes the JSON Schemas and generated Go into a Velox checkout;
  - lld's verify and integration tests take the engine binary from `EXEC_BIN`.
- S05's Valkey workers and its Valkey judge client left with `services/exec`. The `JudgeJob`/`JudgeResult` contract stays.

### P5-W30-S07 Velox: the sandbox, checker, judge API and red-team suite

- IDs: EXEC-1 to EXEC-4; ADR-0041 (PROPOSED). Work in the Velox repo (`RISHIK92/velox`).
- Goal:
  - **The sandbox:** each run gets a fresh container with gVisor, covering the six languages including Go. Time stays on the wall clock until the Linux hosts exist, then moves to cgroup CPU time (owner, 2026-11-12).
  - **The checker:** the LLD checker runs outside the sandbox.
  - **Contract API:** `POST /judge` and `GET /judge/{id}` speak `JudgeJob`/`JudgeResult`.
  - **Queues and workers:** priority queues, and leased, idempotent workers.
  - **A CLI** with `run` and `check` for Interval's tooling.
  - **Acceptance:** the red-team suite, Judge0 adapter included (EXEC-1), with the contract copy checked in Velox's CI.

- Built 2026-11-12 (Velox a5c8f60).

### P5-W30-S08 Interval's Velox adapter (folded into W31)

- IDs: EXEC-2, LOAD-3; ADR-0041 (PROPOSED)
- Folded (2026-11-12): a client with no caller would be a dead export (ARCH-1). The first W31 slice that submits code builds Interval's judge port and its Velox HTTP adapter (`VELOX_URL`, `VELOX_API_KEY`, with an in-memory fake), in whichever service submits: the game server (Go) or the web app (TS), as Q-P5-09 settles. Local problem tooling already runs through Velox's `exec` binary (`EXEC_BIN`).

## Week 31: the battle

### P5-W31-S01 Problem loading

- IDs: LLDQ-4, DB-6
- Needs: W30-S01
- Goal: `problems/lld/*` into Postgres (problems, layers, visible tests), with hidden tests and expected results in the private bucket (moved here from W30-S01).
- Built 2026-11-12: `pnpm problems:load` (TS, apps/web; the `Problem` contract is zod-only, ADR-0040).

### P5-W31-S02 The battle lifecycle

- IDs: LOAD-2, MATCH-6
- Goal: a battle match kind in the game server: rounds, the timed extension round, the clock, snapshots, reconnect grace, abandons.
- Note (ADR-0041 PROPOSED): code goes to Velox's `POST /judge`, not the Valkey queue of Q-P5-09's answer, which predates it. This slice, or W31-S03, builds Interval's judge port and Velox adapter (the folded S08).
- Split (2026-11-13):
  - **S02b-1, built 2026-11-13:** the battle definition (web to game server), the Go Velox client, and scoring.
  - **S02b-2, built 2026-11-13:** the battle actor (the clock and reveal, Run and Submit with cooldowns, verdicts, snapshots, reconnects, abandons and the result), and the battle's match row and stored result.

### P5-W31-S02a Extension rounds in the problem format

- IDs: §6.5, LLDQ-1 to LLDQ-3; Q-P5-15
- Goal: `problem.json`'s optional `extension` (methods and scenarios) with `extension.md`. Base layers are judged through the base interface, and the extension through the extended one. The loader stores the extension's statement and interface for the reveal.
- Built 2026-11-13.

### P5-W31-S02c Extensions for the six problems

- IDs: §6.5; Q-P5-15
- Goal: an extension round for each of the six problems, with references in six languages, verified and mutation-gated.
- Built 2026-11-13.

### P5-W31-S03 The battle page and Monaco

- IDs: §6.5
- Goal: `/play/battle/[id]` (desktop): statement, starter code, Monaco, Run (visible tests) versus Submit (all layers), results by category.
- Q: Q-P5-10.
- Built 2026-11-13.

### P5-W31-S04 Fair-play signals

- IDs: §6.9, DB-5, DB-6
- Goal: paste, focus and 30-second snapshots in the human league; flags to review; never a penalty without review.
- Split (2026-11-13), after Q-P5-17:
  - **S04a:** the paste and focus signals and their flags.
  - **S04b:** the 30-second snapshots to the private bucket, and their 90-day pruning.

### P5-W31-S04a A battle's paste and focus signals

- IDs: §6.9; Q-P5-17
- Goal: an outside paste of 200 or more characters, and focus losses of 30 seconds or longer, recorded by the game server with the match result. A battle is flagged for review on any such paste or on five such aways.
- Built 2026-11-13.

### P5-W31-S04b A battle's code snapshots

- IDs: §6.9, DB-6; Q-P5-17
- Goal: the page posts its code every 30 seconds to `/api/battle/[id]/snapshot`, and only a player in an unfinished match can post. The private bucket keeps snapshots for 90 days, or until a flag on that match is decided.
- Split (2026-11-13):
  - **S04b-1:** saving the snapshots, and viewing them from a flag.
  - **S04b-2:** the pruning job, with its VM timer and EventBridge schedule.

### P5-W31-S04b-1 Saving and viewing snapshots

- IDs: §6.9, DB-6; Q-P5-17
- Goal: `battle_snapshot` rows and their objects in the private bucket; `POST /api/battle/[id]/snapshot`; the page's 30-second timer; `/admin/fair-play/[flag]/snapshots`; and a guest's snapshots moved to the account on sign-up.
- Built 2026-11-13.

### P5-W31-S04b-2 Pruning snapshots

- IDs: §6.9, DB-6; Q-P5-17
- Goal: a daily worker command that deletes the objects and rows of snapshots older than 90 days, unless a flag on that match is still pending. It runs from the VM's timer and an EventBridge schedule.
- Built 2026-11-13.

## Week 32: rooms, windows, the casual queue

### P5-W32-S01 4-player rooms and OpenSkill

- IDs: MATCH-1, C-03
- Goal: rooms of up to 4; OpenSkill ratings in the worker, separate per league.
- Q: Q-P5-11.
- Split (2026-11-13), after Q-P5-18:
  - **S01a:** 1v1 battle ratings, Glicko-2 per league.
  - **S01b:** rooms of 3 or 4, and OpenSkill.

### P5-W32-S01a 1v1 battle ratings

- IDs: MATCH-1, ADR-0034; Q-P5-18
- Goal: a match's league; `battle_rating` and its history, per league and apart from quick games'; a finished or abandoned 1v1 battle rated once with Glicko-2; the monthly season soft reset; the guest merge.
- Built 2026-11-13.

### P5-W32-S01b Rooms and OpenSkill

- IDs: MATCH-1, C-03; Q-P5-11, Q-P5-18
- Goal: battles of 3 or 4 players on the game server and the web; `openskill` (Plackett-Luce) in the worker. A room ranks its players by points, then time; abandoned players rank last. A room rating per league, soft-reset with the season.

### P5-W32-S02 Windows, registration, reminders

- IDs: MATCH-7, §6.6
- Goal: scheduled windows, registration, a reminder push kind, and matching at window start (at least 80% matched is the metric).
- Q: Q-P5-12.

### P5-W32-S03 Scheduled scaling

- IDs: LOAD-4, EXEC-5
- Goal: scale execution hosts before windows (EventBridge Scheduler; the VM timer); synthesized.

### P5-W32-S04 The casual queue and solo fallback

- IDs: MATCH-7, BOT-5
- Goal: always open; after 60 seconds, solo and unranked against a reference timeline.

## Week 33: the AI league

### P5-W33-S01 The AI league

- IDs: §6.2
- Goal: its own problem pool, more extension rounds and separate ratings and boards.

### P5-W33-S02 Ask the interviewer

- IDs: §6.2, AI-1, AI-2, OPS-4
- Q: Q-P5-13.

### P5-W33-S03 Human-league fair play review

- IDs: §6.9
- Goal: code similarity between submissions, an admin review queue, and rating-only penalties.

## Week 34: scale and safety

### P5-W34-S01 Problems 7–15

- Goal: reach 12 to 15 problems.

### P5-W34-S02 A load test of a window start

- IDs: LOAD-4
- Goal: k6 against the local stack: verdicts within 10 seconds for 95% of submissions.

### P5-W34-S03 Red-team rerun

- IDs: EXEC-1

## Week 35: results and launch

### P5-W35-S01 Results and replays

- IDs: DB-6
- Goal: a results page, and replays from snapshots.

### P5-W35-S02 The AI code review

- Q: Q-P5-14.

### P5-W35-S03 Metrics

- Goal: queries for the "Done when": matched, verdict latency, escapes, disputes, injected bugs caught.

### P5-W35-S04 Phase 5 wrap-up

- IDs: ADR-0013
- Goal: the checklist, both stacks synthesized, and a drift audit.
