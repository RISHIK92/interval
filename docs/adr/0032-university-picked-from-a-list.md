# 0032. University picked from a list, unverified, no university email stored

- Status: ACCEPTED
- Date: 2026-11-02
- Supersedes: none (amends §6.7 "university (verified)", OPS-1's university codes and the Phase 3 Week 14 roadmap, for Phase 3)
- Superseded by: none

## Context

The docs make a player's university a verified fact:

- §6.7: "Global, country, university (verified), and friends."
- §5 (onboarding): "University verification uses a one-time code sent to a college email address."
- OPS-1: "SES sends university verification codes."
- docs/roadmap/phase-3.md, Week 14: "university (SES verification with a domain list and a manual review queue)".
- §10 Privacy: "University verification stores only the affiliation, not the email contents."
- C-17 / ADR-0006: universities are ranked by "average rating" of their verified members.

docs/open-decisions.md item 5, "University verification without college email domains", is still open: many universities have no student email domain, so the domain-list route leaves their students out.

The owner's answer to Q-P3-09 (2026-10-31): "the player picks their university from a list (a public list or API, licence checked; Hipo's university-domains-list is a candidate), or types a name if it's missing; admin unifies custom names later. Picking alone counts for the board, with no email verification. … No university email is stored." The question file notes this contradicts §6.7 and Week 14 and needs an ADR before P3-W14-S03. Q-P3-10 (answered) also drops the minimum member count for a university to be ranked.

The candidate list, checked 2026-11-02: Hipo/university-domains-list on GitHub, **MIT licence** (LICENSE.txt), last updated 2026-09-22, 10,268 entries with name, country code, web pages and domains.

## Options

### A. Picked from a list or typed, unverified (the owner's answer)

Profile offers the list (names and countries only, seeded from Hipo's file and kept in the repo with its MIT notice). A missing university is typed as free text and shows on its own until the owner merges it into a listed one at `/admin/universities`. Picking counts for the board at once. No email is asked for or stored; no SES.

- Pros:
  - Works for every university, including those without student email domains (open-decisions item 5 stops blocking Phase 3).
  - Stores nothing beyond the choice: stronger than §10's "only the affiliation".
  - No SES sending, bounce handling or code flow to build and run; one engineer ships it in a slice.
- Cons:
  - Anyone can claim any university. A university board can be inflated or griefed by outsiders, and a small one can be taken over by one player (no minimum size, Q-P3-10).
  - University Cups (Phase 6, §6.4) will need something stronger before prizes or rankings matter there.
  - Typed names need the owner's attention to merge.
- Cost to reverse: medium. Verification can be added later as a badge or a gate (C below) on the same membership row; existing unverified members would then be filtered out or asked to verify. The list and the board code stay.

### B. Email verification as the docs say (domain list plus SES code)

The player enters a college email; a code goes out via SES; the domain must match the list; unknown domains go to a manual review queue.

- Pros:
  - Matches §6.7, OPS-1, §5 and Week 14 as written; boards are trustworthy.
- Cons:
  - Leaves out universities without email domains (the open problem in item 5) unless the review queue absorbs them by hand.
  - Stores a university email at least until verified: personal data §10 wants kept to a minimum.
  - SES setup, sandbox exit, bounces and a review queue: several slices, and the owner chose against it.
- Cost to reverse: medium.

### C. A, plus optional verification later as a "verified" mark

Ship A now; boards count everyone. A later phase adds the email code as an optional badge, and University Cups may require it.

- Pros: same as A now, and keeps a path to §6.7's "verified" for the places that need it.
- Cons: the badge flow is still to build later; until then, same cons as A.
- Cost to reverse: same as A.

## Recommendation (not a decision)

**A**, as the owner answered, with C noted as the path for University Cups. From the docs:

- open-decisions item 5 has no answer for universities without email domains; B can't serve them, A can.
- §10's privacy aim ("only the affiliation") is met strictly by A, which never sees an email.
- Phase 3's university boards are low-stakes (no prizes; ranks only), and ADR-0029 already accepts unverified guests on Play's boards with anti-farming limits, so unverified university membership is in line with what is accepted.

What would change it: abuse on university boards once live, or University Cups (Phase 6) needing trustworthy membership; then C's verification badge, required for cups.

Accepted by the owner on 2026-11-02: option A. The owner's answers to the open questions are below.

## Consequences

If A is accepted:

- **P3-W14-S03 is unblocked:**
  - the list kept in the repo as data (name and country only; Hipo's MIT notice kept beside it), loaded into a `university` table;
  - Profile picks, changes and removes a university, or types a missing one;
  - `/admin/universities` merges a typed name into a listed university (its members move with it);
  - no email field, no SES.
- **P3-W14-S04** ranks universities by members' average challenge score (Q-P3-10), counting every member.
- §6.7's "(verified)", §5's onboarding code, OPS-1's "SES sends university verification codes" and Week 14's SES text don't apply in Phase 3. docs/decisions.md and docs/product.md are not edited; this ADR records the amendment.
- open-decisions item 5 is sidestepped for Phase 3, not closed: it returns if C is taken up.

## Open questions

Answered by the owner, 2026-11-02:

- **Changing it:** at most once in 30 days, removable any time without resetting the clock (the country rule, Q-P3-08).
- **Typed names on boards:** shown at once under the typed name; the owner renames, merges or removes them at `/admin/universities`.
- **Typed name checks** (not asked; the suggested default stands until the owner says otherwise): length 2–120 only; anything else is the owner's moderation at `/admin/universities`.
- **Events:** a university change is a DB-5 event (with the country change, owner 2026-11-02).
