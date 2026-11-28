# 0059. ADR-0058 supersedes ADR-0044 (Also fits on desktop Home)

- Status: PROPOSED
- Date: 2026-11-28
- Supersedes: ADR-0044
- Superseded by: none

## Context

ADR-0044 (ACCEPTED, owner 2026-11-23) put an "Also fits in N minutes" grid under the hero on desktop Home: "the daily challenge, due reviews and one explainer under the hero", each sized to the chosen break.

ADR-0058 (ACCEPTED, owner 2026-11-28) removed the break-length chips, schema included. Its "Removed" list names "the break-length chips: onboarding, profile, the feed's per-chip ranking and `time_fit`, Also fits, the review sizing". Stage B built that: `apps/web/src/app/page.tsx` has no Also fits grid, and the daily challenge and review sit in the feed row on every screen (`page.test.tsx`, "there is no Also fits grid").

ADR-0058's header says "Supersedes: none", and ADR-0044 still reads ACCEPTED with "Superseded by: none". The drift audit of 2026-11-28 (`docs/audits/2026-11-28.md`, "Needs an ADR") flags the two accepted ADRs as contradicting each other. Accepted ADRs are never edited (docs/adr/README.md), so the record needs a new ADR.

## Options

### A. Mark ADR-0044 superseded, by this ADR

- Pros: the record matches the code and ADR-0058; one line changes on ADR-0044 ("Superseded by"), the only edit an accepted ADR allows.
- Cons: none found.
- Cost to reverse: low. Bringing Also fits back needs a new ADR in any case, since there is no break to size it to.

### B. Leave the record as it is

- Pros: no work.
- Cons: two accepted, binding ADRs disagree; the next audit flags it again.
- Cost to reverse: none.

## Recommendation (not a decision)

**A.** ADR-0058's own "Removed" list already names Also fits, so this changes no behaviour; it only makes the record say what was decided.

## Consequences

- ADR-0044's status becomes SUPERSEDED, with "Superseded by: ADR-0059 (for ADR-0058)", and its row in docs/adr/README.md says so.
- No code changes.

## Open questions

- None.
