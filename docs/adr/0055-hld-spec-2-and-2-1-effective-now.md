# 0055. HLD spec 2.0 and 2.1 take effect now, for practice, battles and tournament rounds

- Status: ACCEPTED (owner, 2026-11-26)
- Date: 2026-11-26
- Supersedes: none
- Superseded by: none

Accepted by the owner's own answer in the session of 2026-11-26 ("Everything now"), with the knowledge that 2.0's and 2.1's numbers and provider prices are PROVISIONAL and that the new families' calibration grades are not yet all confirmed.

## Context

ADR-0050 (ACCEPTED) staged the HLD engine extensions as two spec versions, each released at a season boundary (§6): "v2.0 and v2.1 each take effect at a season boundary, with patch notes on `/hld/spec`." Its Option B: "v2.0, then v2.1 at the next season boundary", with the con "families using v2.1 wait a season."

Q-WD-31 (docs/questions/web-design.md, owner, 2026-11-23) fixed the pace: "an HLD season is monthly, like the quick games' season. Spec v2.0 ships at a month boundary and v2.1 at the next one, each with patch notes on /hld/spec."

ADR-0051 (ACCEPTED) set 2.0's date from that: "Cost to reverse: low while 2.0 isn't in effect (before 2026-12-01)", and "A tournament round on a 2.0 family can't start before 2026-12-01 UTC, whatever the cup's start (the round's `not_yet`)."

ADR-0052 (ACCEPTED) set 2.1's: "Q-WD-31: an HLD season is monthly, and v2.1 takes effect at the next boundary after v2.0's (2026-12-01), so 2027-01-01 UTC." It also says "the owner grades the new ones before their families reach battles" of the calibration set.

ADR-0053 (ACCEPTED) restates both: "Spec 2.0 takes effect on 2026-12-01 and 2.1 on 2027-01-01 (Q-WD-31)."

In code these are `SPEC_V2_FROM = "2026-12-01"` and `SPEC_V21_FROM = "2027-01-01"` in `packages/hld/src/spec.ts`. `specInEffect(version, now)` gates every place a 2.x family can reach a player: practice (`practiceProblems`), the battle draw (`drawVariant`), a tournament round (`nextRound`'s `not_yet`) and a cup's creation (the admin action).

On 2026-11-26 the owner decided ("Everything now") that both versions take effect today, for everything, instead of on those two boundaries.

## Options

### A. Everything today: practice, battles and tournament rounds on 2.0 and 2.1 from 2026-11-26 (chosen)

- Pros: all 31 families are playable now, ranked and unranked; one change (two dates) with no new code path; the version boundary logic is untouched (1.0 families stay on 1.0, a family stays on its version, a match rebuilds under the version it was drawn on).
- Cons: both versions start mid-season (the November season is in progress), not at a boundary, against CANVAS-4's "change only at season boundaries"; ranked matches run on PROVISIONAL numbers and prices, and on calibration grades the owner has not all confirmed (ADR-0052's "before their families reach battles"); players get two balance patches at once, not one a month (ADR-0050's "why staged").
- Cost to reverse: low in code (two dates), but once a 2.x match, round or practice design exists it can't be withdrawn without retiring it: a match keeps its version for replays, disputes and appeals (ADR-0050 §6). Any later change to 2.0 or 2.1 numbers is a balance patch.

### B. Practice today; ranked play (battles and tournament rounds) on the season dates

- Pros: players can learn the new components now; ranked results wait for the boundaries and the confirmed grades, as ADR-0050/0052 intended.
- Cons: a second gate (practice vs ranked) with its own dates, tests and copy; unranked battles would need a third answer; the owner asked for everything.
- Cost to reverse: low; but it adds code that disappears on 2027-01-01.

### C. Keep the dates (2026-12-01 and 2027-01-01)

- Pros: matches ADR-0050, 0051, 0052, 0053 and Q-WD-31 as written; no change.
- Cons: the 2.0 families wait five days and the 2.1 families over a month, against the owner's decision.
- Cost to reverse: none.

## Recommendation (not a decision)

The owner chose A. It changes only when a version takes effect; it doesn't change what a version is, so every rule in ADR-0050 to 0053 still holds per version.

## Consequences

- `packages/hld/src/spec.ts`: `SPEC_V2_FROM` and `SPEC_V21_FROM` are both `"2026-11-26"`. Each version's patch notes say it was brought forward from its season boundary (owner, 26 Nov 2026), so `/hld/spec` doesn't present the day as a boundary.
- Every gate keeps reading `specInEffect`; with equal dates, 2.0 and 2.1 families reach practice, the battle draw, tournament rounds and new cups on the same day. Nothing depends on 2.0 preceding 2.1.
- `/hld/spec` says each version is "in effect from" its day rather than "from … a season boundary"; the rule that numbers change only at season boundaries is unchanged for any later patch.
- 1.0 families, the pool, golden designs and calibration fixtures are byte-identical: the date isn't an input to the simulator, the pool or a judgement.
- This amends, without editing, the dates in ADR-0050 §6, ADR-0051, ADR-0052 and ADR-0053, and Q-WD-31's "ships at a month boundary" for 2.0 and 2.1 only. HLD seasons stay monthly; ratings still soft-reset at the season close (ADR-0034).
- Ranked results on 2.x families use PROVISIONAL numbers and prices and any calibration grades not yet confirmed. The owner accepted that; a later correction is a balance patch at a season boundary (CANVAS-4).

## Open questions

- None for this decision. ADR-0053's open question on when price changes ship still stands.
