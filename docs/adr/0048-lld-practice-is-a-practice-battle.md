# 0048. LLD practice is a practice battle on the game server

- Status: ACCEPTED (owner, 2026-11-23)
- Date: 2026-11-23
- Supersedes: none
- Superseded by: none

## Context

The owner asked for LLD practice "like hld" (Q-WD-28). HLD practice runs in the web app, because the simulator is TypeScript. LLD code is judged by Velox, and only the game server calls it today (ADR-0033 runs the matches; ADR-0041 has Velox as the judge). The owner's answers to Q-WD-28 set the rules:

- a practice pool separate from battle problems;
- the battle screen with Run tests and Submit judged as in a battle, and the extension revealed on request;
- no clock, no opponent, unrated;
- the code autosaved and the best result kept;
- no AI.

ARCH-2 says nothing is implemented twice across languages, so the judge client, the job split, scoring and the cooldowns must stay in one place.

## Options

1. **A practice battle on the game server (chosen).** A `practice` flag on the battle definition. It runs with no reveal or end timer, one player, a `reveal` message, no similarity check, and a 60-minute disposable session.
   - Pros: it reuses the judge client, scoring, cooldowns, tickets, the WebSocket protocol and the battle screen.
   - Cons: a new match kind and a progress path from the game server to Postgres.
   - Reversal: moderate.
2. **The web app calls Velox directly.**
   - Cons: a TypeScript copy of the judge client and scorer (against ARCH-2), and a second caller of Velox.
3. **A stateless judge endpoint on the game server.**
   - Cons: a new synchronous coupling from the web app to the game server, outside ADR-0033's shape, with long-held requests, and no reuse of the battle protocol.

## Recommendation (not a decision)

Option 1. The owner approved it.

## Decision

**Problems:**

- Each problem file has a required `pool`, either `practice` or `battle`.
- A practice problem is never in a battle pool, and never moves back to battles once its tests could have been probed.
- First practice pool: lru-cache, parking-lot, meeting-rooms, elevator-system.

**The match:**

- `game_match.mode = 'practice'`, always unrated.
- Ratings, seasons, fair play and the AI code review all key on `mode = 'battle'`, so practice never reaches them.

**A session:**

- The game server stays without a database.
- A session lasts at most 60 minutes, or until the player has been away past the grace. The page then starts a new one.
- Code is autosaved by the web app to `lld_practice_code`. A stale version is refused, as `hld_practice_design` does.

**Progress:**

- After each judged Submit, the actor publishes a practice message (match, sequence, user, problem, points, per-layer counts).
- The worker keeps the best result in `lld_practice_best`. It is idempotent on (match, sequence) (LOAD-5), and the submit count goes up by one.

**Limits:**

- the battle cooldowns: Run every 5 s, Submit every 30 s;
- 50 submits a day in all, 20 per problem a day, and 400 runs a day, kept in Valkey and refused with a stable code;
- the web app rate-limits starting sessions;
- results stay per-layer counts (LLDQ-4).

**Other:**

- **Priority:** practice uses Velox's `casual` priority until Velox has a lower one (a contract change in Velox).
- **Access:** the `play.battle` capability (ADR-0036), as `play.hld` covers HLD practice.
- **Events (DB-5):** `lld_practice_started` and `lld_practice_submitted` carry ids and counts, never code.

## Consequences

- One migration: `lld_problem.pool`; `practice` added to `game_match`'s mode check; `lld_practice_code`; `lld_practice_best`.
- A new queue message for the practice progress (ADR-0010 codegen).
- The human battle pool shrinks to six problems and keeps no hard one until more are written.
- Ranked submissions still send Velox's `casual` priority; the `ranked` and `rooms` priorities are unused. That is an existing gap against EXEC-2, filed separately.

## Open questions

- None.
