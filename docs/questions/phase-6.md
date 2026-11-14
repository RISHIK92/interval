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
