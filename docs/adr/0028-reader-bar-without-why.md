# 0028. The reader's bar drops "Why this matters"

- Status: PROPOSED
- Date: 2026-10-30
- Supersedes: ADR-0018, the "Why this matters" item of its overlay only
- Superseded by: none

## Context

ADR-0018 lists the in-app reader's overlay: "Why this matters" (the AI box when a model
wrote it); Save and Mark done; "Next section" for moments; Highlight, Listen and
"Test me". The why line took a full row of its own, so the bar was two rows tall under
the publisher's page. The owner (2026-10-30): the reader's "why it's here" line "is not
needed anymore", and the bar should be compact.

The card the reader was opened from already says why it's there (§5B, ADR-0027), so
the explanation is still shown before the reader opens.

## Options

### A. Drop the line; one row

- Pros: the publisher's page gets the row back; the card still explains itself.
- Cons: the explanation isn't visible while reading.
- Cost to reverse: low. One component in `read/[item]/page.tsx`.

### B. Keep it as an icon in the row

- Pros: ADR-0018 holds as written.
- Cons: one more control in a full row; the owner asked for it gone.
- Cost to reverse: low.

## Recommendation (not a decision)

A, the owner's choice.

## Consequences

- The reader's footer is one row: Save, Highlight, Listen, Test me, the note icon, then
  Mark done and Next section. The note's text area opens below the row.
- `ReaderPage.reasons` is no longer shown by the reader; removing it from the port and
  adapter is follow-up work.

## Open questions

-
