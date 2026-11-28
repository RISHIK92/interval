# 0060. HLD verdicts only after submit: requirements and scenarios while building, results on submit

- Status: PROPOSED
- Date: 2026-11-28
- Supersedes: none (amends CANVAS-5's browser preview and ADR-0042's live preview)
- Superseded by: none

## Context

The canvas runs the simulator on every valid draft and shows its verdicts as the player builds: points of 60, baseline passed or not, each scenario passed, partly met or failed, the requirement coverage and rule-based hints (`apps/web/src/app/hld/Canvas.tsx`, "The preview simulation runs here, in the browser, on every valid draft, with hints by rule"). That follows:

> **CANVAS-5. The same TypeScript engine runs in the browser for preview and on the server as the official scorer.** (docs/decisions.md)

> `/hld/practice/<slug>` is the canvas with the live preview and hints. (ADR-0042, PROPOSED)

In a match the opponent strip also shows how many scenarios the other player's latest autosave passes ("RS · 3 of 5 scenarios", `hld/match/[id]/OpponentProgress.tsx`). Solo practice has no Submit.

On 2026-11-28 the owner asked: "current hld flow shows requirements and simulation passed on the go while user is building but it should follow -> show requirements and scenarios and let user submit and then show what passed and what failed". The owner then answered:

- **Scope:** practice and matches.
- **Practice:** submit shows the results; the player can edit and submit again, as often as they like.
- **Live while building:** only design errors (a design that isn't valid can't be submitted). Hints and requirement coverage wait for submit.
- **Opponent strip:** hide pass counts until submit; show only that the opponent has submitted.

§6.4 ("an analytical model runs the design through load and failure scenarios. It's deterministic and explains every verdict") is unchanged: every verdict is still explained, after submit.

## Options

### A. Verdicts only after submit, practice and matches (the owner's answers)

- Pros: a match tests the design, not tuning against a live scorer (as LLD keeps hidden tests hidden, §6.5); one rule on every canvas; practice still teaches, by submit and resubmit.
- Cons: less immediate feedback in practice; the browser engine no longer previews while building (it still scores a practice submit).
- Cost to reverse: low. The preview code path stays in `packages/hld`; showing it again is a UI change.

### B. Matches only; practice keeps the live preview

- Pros: practice keeps instant feedback.
- Cons: two canvas behaviours; the owner chose against it.
- Cost to reverse: low.

## Recommendation (not a decision)

**A**, because the owner chose it.

## Consequences

- **While building (practice and matches):** the canvas shows the problem's requirements and its scenarios (names and what each injects), and design errors. No points, no baseline, no scenario marks, no coverage, no hints.
- **Practice:** a Submit button runs the same engine (CANVAS-5) and shows what passed and what failed, with the hints and coverage. An edit after that hides the verdicts again until the next submit. Nothing is rated or ranked.
- **Matches:** Submit works as today (ADR-0043: one official submission, scored on the server); the player sees the verdicts after it. Before both have submitted, the opponent strip shows only "submitted" or "building", with no pass counts.
- **Spectators and replays:** unchanged (see open questions).
- CANVAS-5 still holds: the browser runs the engine for the practice result, the server stays the official scorer.

## Open questions

- Should practice keep a stored history of submits? Default: no, the result is shown and not stored (the design itself still autosaves, ADR-0042).
- Spectators (`/hld/match/<id>/watch`) see each design's live preview today. Players can't watch their own match, so it doesn't leak to them. Default: unchanged.
