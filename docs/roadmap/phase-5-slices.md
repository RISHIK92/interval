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
- Goal: the `problems/lld/<slug>/` format, a loader and validator, and `load-lld-problems` into Postgres (problems, layers, hidden tests in the private bucket); the reference results recorded.

### P5-W30-S02 Mutation testing and property tests

- IDs: LLDQ-2, LLDQ-3
- Goal: mutmut on each Python reference (90% killed is a test) and Hypothesis property tests; concurrency rules per language.
- Q: Q-P5-08.

### P5-W30-S03 The first three problems

- Goal: three problems, PROVISIONAL, with references in five languages, all checks passing.

### P5-W30-S04 Three more problems

- Goal: problems 4–6, as S03.

## Week 31: the battle

### P5-W31-S01 The execution queue

- IDs: LOAD-3, LOAD-5
- Goal: Valkey priority lists, with `services/exec` consuming in priority order, idempotent by submission id, with verdicts on a reply key.
- Q: Q-P5-09.

### P5-W31-S02 The battle lifecycle

- IDs: LOAD-2, MATCH-6
- Goal: a battle match kind in the game server: rounds, the timed extension round, the clock, snapshots, reconnect grace, abandons.

### P5-W31-S03 The battle page and Monaco

- IDs: §6.5
- Goal: `/play/battle/[id]` (desktop): statement, starter code, Monaco, Run (visible tests) versus Submit (all layers), results by category.
- Q: Q-P5-10.

### P5-W31-S04 Fair-play signals

- IDs: §6.9, DB-5, DB-6
- Goal: paste, focus and 30-second snapshots in the human league; flags to review; never a penalty without review.

## Week 32: rooms, windows, the casual queue

### P5-W32-S01 4-player rooms and OpenSkill

- IDs: MATCH-1, C-03
- Goal: rooms of up to 4; OpenSkill ratings in the worker, separate per league.
- Q: Q-P5-11.

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
