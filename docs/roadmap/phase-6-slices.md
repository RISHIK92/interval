# Phase 6 slices

Phase 6 (docs/roadmap/phase-6.md) is HLD battles. From Phase 5 W32 on, the owner has each roadmap week built and committed as one unit: questions once at its start (docs/questions/phase-6.md), one review, one commit. Each week below is its own unit. Field key as in Phase 5.

Already in place, and reused:

- **The diagram library** (`packages/diagrams`, TTS-5): the canvas builds on it (CANVAS-1).
- **The battle stack** (Phase 5): the game server's actors, windows, the casual queue, ratings (1v1 Glicko, rooms OpenSkill), results, replays, disputes, fair-play review, and the AI interviewer and code-review jobs through the gateway.

## Week 36: the design schema, the component catalog, spec sheet v1

- IDs: HLDQ-1, CANVAS-2, CANVAS-4; Q: Q-P6-01.
- Goal:
  - `packages/hld` (TS): the versioned design graph (nodes of typed components with their config and a "why" note; edges that route requests);
  - the 12-component catalog with PROVISIONAL spec v1.0 numbers and patch notes;
  - the public `/hld/spec` page.
- Built 2026-11-14.

## Week 37–38: the simulation engine

- IDs: CANVAS-3, CANVAS-5; HLDQ-1.
- Goal:
  - the deterministic analytical engine in `packages/hld`: routing, cache hit rates, queueing p50 and p99, storage growth, failures by mode, availability per scenario;
  - the problem format (requirements, targets, traffic, scenarios, rubric, allowed components, time limit);
  - verdict explanations;
  - golden-design regression tests;
  - browser and server builds.
- Built 2026-11-14.

## Week 39: the canvas

- IDs: CANVAS-1, CANVAS-2.
- Goal: React Flow on the diagram library, configuration panels, "why" notes, autosave, preview simulation, and hints.

## Week 40: problem families

- IDs: HLDQ-2, HLDQ-3.
- Goal: 6 to 8 families, the variant generator, flawed-design catalogs, validation, and AI-league variants.

## Week 41: the AI judge and the coach

- IDs: CANVAS-6, AI-2, AI-5.
- Goal: the median-of-3 rubric judge, injection hardening, the calibration set, appeals, and the post-match coach.

## Week 42: HLD matches

- IDs: MATCH-1, MATCH-7, LOAD-2.
- Goal:
  - the match flow and the official simulation worker;
  - scoring: simulation 60, rubric 25, speed 15, with the baseline gate;
  - 1v1 and rooms, windows, and the casual queue.

## Week 43: tournaments

- Goal: Swiss rounds, the top-8 bracket, university scoring (each university's top 5), check-in, and admin tools.

## Week 44: spectating and the cup's readiness

- Goal: spectating, design replays, results with the rubric, a tournament load test, and 2 to 3 hand-written cup problems.

## Week 45: the cups (the owner's)

- Goal: a practice cup with beta universities, then the first University Cup. Claude prepares a runbook.
