# Phase 6 questions

Phase 6 (docs/roadmap/phase-6.md) is HLD battles. The process is the owner's from Phase 5 W32 on: a roadmap week is built as one unit, with its questions asked once at its start.

## Week 36: the design schema, the component catalog, spec sheet v1

### Q-P6-01 The component catalog, its numbers, the spec page and the phase's scope (P0 for W36)

- Cite: HLDQ-1, CANVAS-1 to CANVAS-5, §6.4.
- **Answers (owner, 2026-11-14):**
  - **Catalog v1:** 12 components:
    - the client (the traffic source);
    - a CDN;
    - a load balancer;
    - an app service;
    - a cache;
    - a relational database (a primary plus read replicas);
    - a key-value store;
    - a message queue;
    - a worker service;
    - object storage;
    - a search index;
    - a stream processor.
  - **Numbers:** Claude drafts spec v1.0 from typical real-world figures (capacity, latency, cost, failure rates), marked PROVISIONAL. The owner reviews them before launch. After launch, numbers change only at season boundaries, with patch notes (CANVAS-4).
  - **The spec sheet:** a public, versioned page at `/hld/spec` (no sign-in), rendered from the catalog in the repo, with each version's patch notes.
  - **Scope:** Claude builds W36 to W44. W45's practice cup and first University Cup are run by the owner (inviting universities, scheduling), with the admin tools and a runbook ready.

## Weeks 37–38: the simulation engine

### Q-P6-02 Simulation scoring, cost and queueing (P0 for W37)

- Cite: §6.4 (simulation 60, rubric 25, speed 15; the baseline gate), CANVAS-3, CANVAS-5, HLDQ-1.
- **Answers (owner, 2026-11-14):**
  - **Simulation points:** a problem lists weighted scenarios (baseline, peak, node, zone and region failure), each with targets. A scenario earns its weight times how well it meets its targets: 1 when met, falling smoothly as a target is missed, and 0 at twice the target or in overload. Failing the baseline scenario earns no rubric points.
  - **Queueing:** each component is c identical servers (M/M/c). The wait comes from Erlang C, and p50 and p99 from its exponential tail. 100% utilization or more is overload: requests are dropped and the scenario fails.
  - **Cost:** unanswered. Claude took the recommended default, for the owner to confirm: each problem sets a monthly budget, and going over it is a missed target in every scenario, scored like any other.
  - **Request kinds (Claude, from the engine review):** each request type says whether it is a read or a write. A write goes to a relational database's primary, is never cacheable, and decides where data is kept (storage).

## Week 39: the canvas

### Q-P6-03 Hints, autosave and preview (P0 for W39)

- Cite: CANVAS-1, CANVAS-2, CANVAS-5.
- **Answers (owner, 2026-11-14):**
  - **Hints:** come from the preview simulation, by rule (an overloaded component, a dead end, a single zone, an unkept write): no model calls.
  - **Autosave:** on the server, one design per user per match, debounced about 2 seconds, in Postgres. Its versions are the design's replay.
  - **Preview:** unlimited, in the browser. The official score is recomputed on the server at submit.
  - **Where the canvas lives before W42 (owner, 2026-11-14):** solo practice for everyone. `/hld/practice` lists the practice problems, and each opens on the canvas, autosaved per player per problem. This is new product behaviour, recorded as ADR-0042 (PROPOSED).
  - **The dependency (owner, 2026-11-14):** `@xyflow/react` 12.12.0, pinned exactly (CANVAS-1).

## Week 40: problem families

### Q-P6-04 Families, variants, the AI league and practice (P0 for W40)

- Cite: HLDQ-2, HLDQ-3, ADR-0042 (PROPOSED), Q-P5-20.
- **Answers (owner, 2026-11-14):**
  - **Families:** 8, PROVISIONAL for the owner's review:
    - URL shortener;
    - photo sharing (object storage and a CDN);
    - news feed (fan-out through a queue and workers into a key-value timeline);
    - chat (a stream and a key-value store);
    - search and autocomplete (a search index);
    - checkout (a relational primary, a queue and workers);
    - metrics ingestion (a stream, workers and a key-value store);
    - a rate limiter (latency-tight, key-value heavy).
  - **Variants:** a seeded, validated pool. A variant is (family, league, seed), and its parameters come from the seed deterministically. A command generates seeds, validates them and records the passing ones per family. Matches draw from that pool, so a variant never fails mid-match, and the same seed rebuilds the same problem for replays and disputes.
  - **The AI league:** the same families, with harder numbers (more traffic, tighter p99, less budget headroom) and a region-failure scenario. Validated like any variant.
  - **Practice:** each family keeps reserved practice seeds, never used in matches.

## Week 41: the AI judge and the coach

### Q-P6-05 Practice feedback, the scale, calibration and appeals (P0 for W41)

- Cite: CANVAS-6, AI-2, AI-3, AI-5, OPS-4, §6.4, ADR-0042 (PROPOSED).
- **Answers (owner, 2026-11-16):**
  - **Practice:** a "Get feedback" request on a practice design runs the judge (3 calls, the median) and the coach through the gateway, within each player's AI budget (OPS-4). Labelled AI; never touches ratings.
  - **The scale:** each rubric criterion is graded at one of five anchored levels, with a one-line reason: 0 missing, 1 mentioned, 2 reasoned, 3 a sound trade-off, 4 excellent with alternatives weighed. The median of 3 per criterion. Rubric points = 25 × the weighted mean level / 4.
  - **Calibration:** about 50 candidate designs generated from the families (references, flawed designs, naive designs, empty notes, notes that try to inject), graded by the owner at `/admin/hld-calibration`. An eval command reports the judge's agreement; the owner runs it, since it calls the model.
  - **Appeals:** once per judgement, within 7 days, with a short reason. The owner re-grades at `/admin/hld-appeals`; the owner's grade replaces the judge's, and the appeal joins the calibration set.

## Week 42: HLD matches

### Q-P6-06 Where matches run, speed, ratings and windows, a missing judgement (P0 for W42)

- Cite: §6.4, MATCH-1, MATCH-7, LOAD-2, CANVAS-5, ARCH-1, ADR-0034, Q-P6-03.
- **Answers (owner, 2026-11-16):**
  - **Where:** in the web app and Postgres. The web app starts a match (its deadline in the row), autosaves each player's design versions (the replay, Q-P6-03), and computes the official simulation server-side at submission or the deadline. The Python worker judges, and rates by the places the web app sets. No new deployable (ARCH-1). Recorded as ADR-0043 (PROPOSED), since the roadmap says "the official simulation worker".
  - **Speed:** 15 × (time left ÷ time limit) at submission, only for a design that passes the baseline. A design auto-submitted at the deadline earns 0.
  - **Ratings and windows:** separate from LLD's. HLD has its own Glicko (1v1) and OpenSkill (rooms) ratings per league, its own boards, and its own ranked windows at LLD's times with their own registration.
  - **A missing judgement:** results wait up to 15 minutes for every judgement. If any player's is unavailable, the match is scored for everyone on simulation and speed (out of 75, scaled to 100), logged and counted.
