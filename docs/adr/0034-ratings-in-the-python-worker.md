# 0034. Quick-game ratings are computed by the Python worker

- Status: ACCEPTED
- Date: 2026-11-02
- Supersedes: none (amends MATCH-1's "TypeScript worker")
- Superseded by: none

## Context

MATCH-1 (docs/decisions.md): "Glicko-2 for 1v1, OpenSkill for rooms. Updates are calculated after the match by a TypeScript worker, not the Go server."

There is no TypeScript worker. Every background job runs in the Python worker:

- ADR-0008 gives it the ranking and AI jobs;
- ADR-0014 gives it the queue consumers;
- since P3-W15-S05 it also records live match results (game_match, from the game server's Valkey hand-off).

ARCH-2 says nothing is implemented twice across languages, and that each deployable arrives only in the phase that needs it (ARCH-1).

Q-P3-02, answered by the owner on 2026-10-31: "(b), the Python worker. Needs an ADR amending MATCH-1 before W16-S01."

P3-W15-S05 records each finished match once (`game_match.finished_at`, outcome, winner and per-player totals), and deliberately queues no rating message yet, because nothing would consume it.

## Options

### A. The Python worker computes Glicko-2 (the owner's answer)

- A rating stage in the existing worker.
- When the `match_finished` stage records a finished or abandoned match, it rates it in the same transaction, once per match (a `rated_at` mark).
- Ratings are one shared quick-game rating per player (MATCH-2), with their history.
- Pros:
  - no new deployable;
  - the rating sits next to the result, so the write and the rating are exactly-once together;
  - Glicko-2 is about 150 lines with no dependencies, tested against Glickman's worked example.
- Cons:
  - departs from MATCH-1's language;
  - the rating code is Python, while the boards' reads are TypeScript (reads only: no logic is duplicated).
- Cost to reverse: low. The formula is self-contained; moving it to a TypeScript worker later would mean moving one module and its tests.

### B. A new TypeScript worker, as MATCH-1 says

- Pros: matches the text.
- Cons:
  - a new deployable in both modes (VM compose, Fargate);
  - a second queue consumer stack;
  - the owner chose against it.
- Cost to reverse: medium.

### C. The web app rates on the player's next visit (like S05's evidence)

- Pros: no worker change.
- Cons: ratings would depend on visits, so an opponent who never returns leaves the other player's rating stale; MATCH-1 wants an update after the match.
- Cost to reverse: low.

## Recommendation (not a decision)

**A**, as Q-P3-02 answers. ADR-0008 already puts ranking work in the Python worker, and S05 made it the place where a match's result is recorded once. Rating in that same transaction is the simplest exactly-once design. C couples ratings to visits, against MATCH-1's "after the match".

Accepted by the owner on 2026-11-02: option A.

## Consequences

If A is accepted:

- **P3-W16-S01 is unblocked:**
  - a `player_rating` table (rating, RD, volatility, games) and `rating_history`;
  - Glicko-2 in `interval_jobs/ratings.py`, tested against Glickman's example;
  - the `match_finished` stage rates once (`game_match.rated_at`).
- MATCH-1's "TypeScript worker" reads as "the worker" for quick games. OpenSkill for rooms (battles, later phases) follows the same rule when it arrives.
- docs/decisions.md isn't edited; this ADR records the amendment.

## Open questions

Answered by the owner, 2026-11-02:

- Starting values are Glickman's: rating 1500, RD 350, volatility 0.06, τ 0.5. Each match is its own rating period, so ratings move right after a match.
- Guests are rated too. On sign-up the guest's rating merges into the account, which keeps the more-played rating.
- An abandon rates as a loss for the leaver and a win for the one who stayed. Both abandoned rates each as a loss to the other. Cancelled and void matches are unrated.
- On a merge, only the surviving rating's history stays with the account, so its history chains to its rating.
- Because a rating period is always one match, an idle player's RD doesn't widen over time.
