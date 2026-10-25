# 0001. Record decisions as ADRs; source precedence

- Status: ACCEPTED
- Date: 2026-10-25
- Supersedes: none
- Superseded by: none

## Decision (owner, 2026-10-25)

Option A, with the precedence as recommended.

## Context

The blueprint (docs/_source/interval-blueprint-2026-10-23.md) holds a numbered decision log (Part II) and a list of open decisions (Part IV). Building it over ~45 weeks will raise questions the log does not answer: schema ownership, auth provider, hosting, and conflicts between the three source documents (docs/conflicts.md). Each answer needs a durable, citable record that future plans, commits and reviews can point to.

Three sources exist and disagree in places:
- interval-blueprint-2026-10-23.md (Oct 23): product, architecture, roadmap.
- interval-blueprint-wireframes.html (Oct 22): wireframes plus an older blueprint text.
- platform-blueprint-early.md: the earliest feature inventory.

The owner makes every architecture and product decision. Claude proposes and implements.

## Options

### A. ADRs in docs/adr/, with decisions.md frozen

decisions.md and product.md stay verbatim copies of the blueprint. Every new or changed decision is a numbered ADR. ACCEPTED ADRs override the copies.
- Pros: the blueprint text stays intact and diffable against the source. Every change has its own record with context and options. Plans cite one ID scheme (Part II IDs plus ADR numbers).
- Cons: to know the current rule, you may need to read decisions.md and any ADR that overrides it. Needs the ADR index kept current.
- Cost to reverse: low. ADRs can be folded into a rewritten decision log later.

### B. Edit decisions.md in place

Change the decision log directly and record history in git.
- Pros: one file holds the current rule.
- Cons: loses the link to the source blueprint. Rationale lives only in commit messages. Easy for Claude to "tidy" decisions without a visible proposal step.
- Cost to reverse: medium. Reconstructing why a decision changed means reading git history.

### C. Decisions in an external tool (Notion, Linear, Claude Docs)

- Pros: easier to read and comment on outside the editor.
- Cons: Claude cannot rely on it being present in a session. Not versioned with the code.
- Cost to reverse: medium.

## Recommendation (not a decision)

Option A. It keeps the blueprint verbatim, which the bootstrap rules require, and gives every change a visible PROPOSED step before it binds.

Precedence, highest first:
1. ACCEPTED ADRs in docs/adr/.
2. docs/decisions.md (Oct 23, Part II).
3. docs/product.md (Oct 23, Part I).
4. docs/wireframes/ (Oct 22 HTML): UI layout and flows only. Where its text disagrees with the Oct 23 file on product or technical behavior, Oct 23 wins.
5. docs/_source/platform-blueprint-early.md: historical context only. Never authoritative.

Where sources disagree or are silent on behavior needed for a slice, Claude stops and asks. The answer becomes an ADR or an entry in ADR-0006.

## Consequences

- CLAUDE.md states this precedence and forbids editing decisions.md, product.md, docs/_source/ and ACCEPTED ADRs.
- /adr drafts ADRs as PROPOSED only. Only the owner changes status.
- The drift-auditor checks code against decisions.md and ACCEPTED ADRs.

## Open questions

- Should Part IV open decisions be closed only by ADRs, or can a decision log entry in a future blueprint revision close them? Suggested default: ADRs only, until a new blueprint revision replaces docs/_source/.
