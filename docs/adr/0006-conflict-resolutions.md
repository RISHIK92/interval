# 0006. Resolutions for source conflicts in Phases 1–3

- Status: ACCEPTED
- Date: 2026-10-25
- Supersedes: none
- Superseded by: none

## Decision (owner, 2026-10-25)

Option A. Every row below is accepted as proposed, except where this list differs:
- C-01: quick-game bot fallback after **10 s**, not 15 s.
- C-06: Home and Library tabs plus Profile from the avatar. No Explore or search in Phase 1 (Q-P1-42).
- C-17: universities ranked by **average rating** of verified members (HTML W7), not the top-5 total.
- C-25: users can pause and skip path sections. The approved order stays fixed.
- C-27: log-ratio decay. Full points within 1.25×, falling linearly in log space to 0 at 10× off.
- C-28: account deletion on request (manual) in Phase 1; export later. No admin "disable source" switch; disabling a source happens in the seed file.
- C-31: rooms are both ranked (in windows, OpenSkill) and casual (start with 2–3 after a timeout).
- Confirmed as proposed: C-07, C-10 (elapsed time only), C-18 (WebSub after Phase 1), C-19 (following after Phase 1), C-20 (no filters), C-21 (one screen, three fields), C-22 (return prompt and Mark section done), C-23 (opening a moment card opens that moment), C-30 (GitHub only).

## Context

docs/conflicts.md lists 33 disagreements or gaps between the Oct 23 blueprint, the Oct 22 HTML, and the early doc. This ADR proposes a resolution for each one that affects Phases 1–3, using the precedence in ADR-0001: Oct 23 wins on product and technical behavior; the HTML wins only on UI layout and flow; the early doc never wins.

Items marked **Confirm** are where precedence gives an answer that drops something the owner may want, or where Oct 23 is silent and the HTML is the only statement. Each one can be accepted or rejected on its own. Items for Phases 4–7 (C-03, C-04, C-12, C-15, C-16, C-26, C-31, C-33) are resolved in conflicts.md and need no decision before Phase 4.

## Options

For the ADR as a whole:

### A. Accept all resolutions below, with per-item overrides noted on acceptance

- Pros: one decision unblocks the Phase 1 slices that depend on these items.
- Cons: the owner must read every Confirm item.
- Cost to reverse: low per item; a later ADR supersedes one row.

### B. Split into one ADR per conflict

- Pros: finer history.
- Cons: ~20 ADRs for mostly mechanical precedence calls.
- Cost to reverse: none.

## Recommendation (not a decision)

Option A, with each Confirm item answered explicitly.

### Phase 1

| Conflict | Proposed resolution | Confirm |
|---|---|---|
| C-05 Moment deep links | Oct 23 order: heading anchor, else text fragment (`#:~:text=`), else top of page with the section title on the card. No scroll-position links on web. Store the link type per moment so the Week 6 script can report by type. | no |
| C-06 Navigation | Oct 23: five areas, Profile from the avatar, no Listen tab. For Phase 1, show Home and Library only; hide Explore, Paths and Play until their phase. | **Confirm** (which tabs ship in Phase 1) |
| C-07 Surfaces | Phase 1 is the PWA only. Mobile wireframes 01, 02, 04, 08, 09 guide the phone-width PWA layout; W1 guides desktop web. Screen 03 (native in-app browser) is Phase 4. | **Confirm** |
| C-18 Ingestion methods | Oct 23: scheduled polling of RSS/Atom feeds in Phase 1 (Week 2 says "scheduled polling"). WebSub push deferred to after Phase 1. Publisher APIs not built unless a seed source needs one. | **Confirm** (WebSub timing) |
| C-19 Per-source controls | Hide source ships in Phase 1 (§5C). Following sources is in Oct 23 (REC-1, §5K) but no Phase 1 week schedules it: proposed for after Phase 1. Mute and prioritize (HTML-only) are not adopted. | **Confirm** (following timing) |
| C-20 Feed controls and filters | Control set from Oct 23; placement from HTML: Save and Why this? on the card, More like this, Less like this, Not interested, Hide source in the overflow menu. Test 60s is Phase 2. No filters in Phase 1. | **Confirm** (no filters) |
| C-21 Onboarding | Collect topics, level, break length only (Oct 23 §5A). One screen in Phase 1; the HTML's Projects and Play steps arrive with GitHub (Phase 2) and Play (Phase 3). No format preference. | **Confirm** |
| C-22 Section completion on web | Oct 23 return prompt ("Finished this section? Continue to the next?") on returning to the tab. Also a Mark section done control in the context panel (HTML W1), since the return prompt can be dismissed. | **Confirm** (adding Mark section done) |
| C-23 Opening a card directly | Time budget alone picks moment vs whole article (Oct 23). Opening a moment card opens that moment; no automatic switch to the whole article. | **Confirm** |
| C-32 Onboarding topics | Four launch topics from §2: system design, databases, distributed systems, backend. | no |
| C-24 Why-this-matters input | Oct 23: from the top ranking signal (REC-5). Phase 1 has no project context, so notes use the ranking signal only. | no |
| C-28 HTML-only statements | Data export/delete: not in Phase 1 unless confirmed; guest data cleanup still needed (Q-P1-12). Content-removal admin tool: add a per-source "disable" in the Week 3 admin page, since the per-source moments switch (§3.2) already exists. | **Confirm** |

### Phase 2

| Conflict | Proposed resolution | Confirm |
|---|---|---|
| C-08 Question bank review | Oct 23: generator-validator auto-validation (Q-1), 10% weekly spot check plus flagged (Q-2). No human gate on everyday questions. | no |
| C-11 Books | PDF upload only (§5F, ING-5). No ebook integrations, no URL import. | no |
| C-30 Manual projects | GitHub only (§5H). No manual project entry. | **Confirm** |
| C-25 Topic path ordering | LLM proposes, owner approves (Oct 23). Per-user reorder/skip is not in Phase 2 unless confirmed. | **Confirm** |

### Phase 3

| Conflict | Proposed resolution | Confirm |
|---|---|---|
| C-01 Bot fallback | Quick games: ghosts first, then labeled bots, half-weight ratings (BOT-1 to BOT-4). Battles: no bots (BOT-5). Fallback timeout for quick games: 15 s, taken from the HTML because Oct 23 gives none; countdown and "Play bot now" from screen 11. | **Confirm** (15 s) |
| C-02 Quick games | Four games per Oct 23. No Solo blitz. | no |
| C-09 Agent task topic | Hook sends started and finished only. No task-topic switch in Profile. | no |
| C-10 Agent time-left estimate | Show elapsed time since "started", not an estimate of time left, since the hook sends no duration. | **Confirm** |
| C-13 Ratings | MATCH-1 and MATCH-2: one shared Glicko-2 quick-game rating at first. | no |
| C-29 Quick-game leagues | Quick games are human-only (§6.2); the league switch applies to battles. | no |
| C-14 Fair-play signals | Oct 23 list. Typing patterns and rating jumps not collected. | no |
| C-17 University leaderboard | Oct 23 is silent outside cups. Proposed: rank universities by the total of their top 5 members' ratings, mirroring the cup rule (§6.4), instead of the HTML's average rating. | **Confirm** |
| C-27 Estimation scoring | Oct 23: scored by ratio off the answer, full points within ±25%. The partial-credit curve outside ±25% is unspecified. | **Confirm** (curve) |

## Consequences

- Phase 1 slices that touch onboarding, feed controls, reading, navigation and ingestion depend on this ADR being ACCEPTED (see docs/roadmap/phase-1-slices.md).
- Rejected Confirm items become new ADRs or questions.

## Open questions

- Every **Confirm** row above.
