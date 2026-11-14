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
