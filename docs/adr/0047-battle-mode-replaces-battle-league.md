# 0047. "Battle mode" replaces "league" for human and AI battles

- Status: ACCEPTED (owner, 2026-11-23)
- Date: 2026-11-23
- Supersedes: none
- Superseded by: none

## Context

§6.2 and the glossary use "league" for the two kinds of battle: "**League.** Battles have two leagues from launch, human and AI, with separate ratings and leaderboards. Quick games are human-only." The code follows that name everywhere:

- a `league` column (`'human' | 'ai'`) on about 15 tables (battle and HLD matches, windows, registrations, ratings, room ratings, season boards, tournaments, retired variants);
- the TypeScript `League` type and `?league=` links;
- the Python rating stages;
- the Go game server's `Battle.League`;
- the queue message schemas.

ADR-0045 (ACCEPTED) brings weekly leagues: cohorts of 30 in six tiers, which the web design calls "Sapphire league". Two meanings of one word would confuse players and code alike. Asked how to avoid the clash, the owner chose to rename the battle term everywhere (Q-WD-07 follow-up, 2026-11-23), so that "league" means only the weekly cohort.

## Options

1. **Full rename (chosen by the owner):** "battle mode" everywhere.
   - Pros: one meaning per word in UI, docs, code and data.
   - Cons: a cross-language refactor. History stays: earlier events, migrations and ADRs keep "league".
   - Reversal cost: another rename of the same size.
2. **Rename in the UI only.** Battle leagues show as "human battles" and "AI battles"; the code keeps `league`.
   - Pros: cheap.
   - Cons: code and docs keep two meanings, and new league code must avoid the name.
3. **A different name for the weekly cohort.** Against the design's "Sapphire league".

## Recommendation (not a decision)

Claude recommended option 2 for cost. The owner chose option 1, so this ADR records option 1.

## Decision

**Names:**

- the term is **battle mode**, with the values `human` and `ai`;
- in the UI: "Human mode" (no AI use allowed) and "AI mode" (any AI tools allowed);
- in code:
  - TypeScript `BattleMode`;
  - the database column `battle_mode` (values unchanged, checks kept);
  - Python `battle_mode`;
  - Go `Battle.Mode`, with the JSON field `battle_mode`;
  - the query parameter `?mode=`.

**What is renamed and what isn't:**

- Done with one migration (`alter table … rename column league to battle_mode` on each table, plus its check constraints), so no data moves.
- The glossary replaces "League", "Human league" and "AI league" with "Battle mode", "Human mode" and "AI mode", and gives "League" the ADR-0045 meaning.
- Event properties: new events say `battle_mode`. Earlier events keep `league`, and the metric queries read both.
- docs/decisions.md and docs/product.md keep §6.2's wording (they are not edited); this ADR maps it: §6.2's "league" means battle mode.
- Accepted ADRs and past migrations keep their text.

## Consequences

- A link with `?league=ai` from before the rename still works: it is read as `?mode=ai` once, then dropped.
- Every test is updated with the names; nothing about how battles behave changes.
- New weekly-league code (ADR-0045) owns "league".

## Open questions

- None.
