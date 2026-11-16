# 0043. HLD matches run in the web app; their official score is simulated there

- Status: PROPOSED
- Date: 2026-11-16
- Supersedes: none (amends the Phase 6 roadmap's "the official simulation worker")
- Superseded by: none

## Context

The Phase 6 roadmap's Week 42 is "match flow, the official simulation worker, scoring with the gate, 1v1 and rooms, windows and the casual queue" (docs/roadmap/phase-6.md). CANVAS-5 has the same simulator run in the browser (the preview) and for the official score. LOAD-2: "the game server uses the match-actor model".

The simulator is TypeScript (`packages/hld`, ARCH-2), and there is no TypeScript worker: ADR-0034 moved MATCH-1's "TypeScript worker" to the Python worker, and every background job runs there. ARCH-2 forbids implementing the simulator twice. HLD play has no real-time moves between players: each player draws alone against the clock and submits once. Q-P6-06 (owner, 2026-11-16) chose the web app and Postgres.

## Options

### A. The web app and Postgres (the owner's answer)

- The web app starts a match with its deadline in the row, keeps each player's autosaved design versions (the replay, Q-P6-03), and at submission (or for whoever hasn't, once the deadline passes) runs the official simulation server-side, in milliseconds. It requests the AI judgements (the Python worker writes them), scores the match once they're in (or after 15 minutes), sets places, and queues the ratings, which the Python worker computes in HLD's own tables.
- A match moves on when anyone looks at it: the players' match and result pages poll it, and the Play page moves the player's own matches on.
- Pros: no new deployable (ARCH-1); one simulator (ARCH-2); the official score is the preview's code, as CANVAS-5 wants.
- Cons: a match nobody looks at again waits to be scored until someone does. A timer that moves it on would need the worker to call the web app, which nothing does yet.
- Cost to reverse: moderate. The steps are functions of the match row; a worker or the game server could call them later.

### B. The Go game server's match actor

- Pros: LOAD-2's actor model; the actor's timer closes a match on time.
- Cons: the Go server can't run the TypeScript simulator, so it would call the web app for every score. That's much more code, for a game with no real-time moves.
- Cost to reverse: high.

### C. A new TypeScript worker

- Pros: literal to the roadmap; a queue consumer could close matches on time.
- Cons: a fourth deployable, with its own image, infra and runbook, for a millisecond computation.
- Cost to reverse: moderate.

## Recommendation (not a decision)

A, as the owner chose. If matches left unscored become a problem, add a scheduled call from the worker's timers to a web endpoint that moves due matches on, behind a shared secret.

## Consequences

- `hld_match`, `hld_match_player` and `hld_design_version`; `hld_judgement` gains the match it's for.
- HLD's own ratings: `hld_rating` and `hld_room_rating`, with their histories, per league (Q-P6-06).
- `packages/hld` scores a match: speed, the rubric gate, the scaling when a judgement is missing, and places.
- The Python worker rates a scored match from its places (`rate_hld_match`).

## Open questions

- Should a timer move due matches on (see the recommendation)?
