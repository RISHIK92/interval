# 0029. Guests for Play

- Status: ACCEPTED
- Date: 2026-10-31
- Supersedes: none (amends ADR-0016, for Play only)
- Superseded by: none

## Context

The owner's answer to Q-P3-03 (2026-10-31): guests can do everything on the Play tab, boards and live games included, and "once account created merge with the guest status".

What's in the way:

- **ADR-0016 (ACCEPTED, option B):** account first; "the guest code stays but no screen creates guests during the beta". `startGuest` (`apps/web/src/server/guest.ts`) is unused since.
- **Q-P1-24:** "An invite code is required for any access during the private beta, including guest mode." When a guest signs up, the account reuses the guest's code and group.
- **Q-P1-12:** 30-day sliding guest cookie; inactive guests deleted after 30 days (`purge-guests` exists).
- **Q-P1-11:** merge rules accepted; the merge itself (P1-W1-S12) was never built.
- **§6.7 boards and MATCH-1/2 ratings:** guests are cheap to create, so one person can make many and farm boards and ratings, or feed their own account wins.

Still built and dormant: Better Auth anonymous users (ADR-0004), guest sessions (P1-W1-S10), `is_guest` in events, `purge-guests`.

## Decision

Accepted by the owner on 2026-10-31: option A. The open questions below still need answers before the slices that depend on them.

## Options

### A. Guests for Play, with limits (the owner's answer, bounded)

The guest entry comes back, landing on Play only; the rest of the app keeps asking for an account (ADR-0016 holds outside Play). Guests play every quick game, appear on boards and play live. On sign-up their Play data merges into the account.

Limits against farming:

- one guest per browser (the existing guest cookie), and guest creation rate-limited per IP (LOAD-6);
- guests are marked "Guest" on boards; a guest's rating starts provisional like any new player's (Glicko-2's high deviation does this already);
- a guest can't play a live match against the account that later absorbs it (no self-feeding: matchmaking never pairs a guest with an account from the same browser);
- fair-play flags (§6.9) apply to guests the same way;
- a guest deleted after 30 days of inactivity (Q-P1-12) leaves the boards with it.

- Pros: the owner's answer; a fast way in to the most shareable part (challenge links, share cards); reuses the dormant guest code.
- Cons: the merge (P1-W1-S12) must be built now; guests on boards add moderation load; two kinds of player on every Play surface.
- Cost to reverse: medium: turn the guest entry off again; merged data stays.

### B. Guests for Play, unranked

As A, but guests aren't on boards and their games don't change ratings until they sign up (then their recorded results count from the merge on).

- Pros: no farming at all; still a fast way in.
- Cons: not what the owner answered ("everything including boards").
- Cost to reverse: low.

### C. Keep account-first (ADR-0016 as is)

- Pros: no new rules; nothing to merge.
- Cons: the owner chose otherwise.
- Cost to reverse: none.

## Recommendation (not a decision)

**A**, as the owner answered, with the limits above. If farming shows up in the beta's fair-play flags, B is a one-line change in the board and rating writes.

## Consequences

If A is accepted:

- **Entry:** a "Play" entry on the landing page and every challenge link start a guest when there's no session (the invite rule per the open question below).
- **P3-W13-S01** turns the guest entry back on for Play only; other tabs ask a guest to create an account.
- **The merge** (P1-W1-S12, with Q-P1-11's rules) is built in Phase 3, scoped to Play data: games, answers (and so mastery evidence), ratings, streaks and freezes, board entries. A slice is added to Week 13.
- **Boards and ratings** carry an `is_guest` mark; the anti-farming rules get tests.
- **Metrics:** Phase 3's "Done when" counts guests as players; Q-P1-21's return metric still excludes them.
- docs/product.md isn't changed by this ADR; the owner records it.

## Open questions

- During the private beta, does a guest still need an invite code (Q-P1-24)? Suggested: yes on the landing entry; a challenge link counts as the sender's invite (same group, no code use consumed).
- Merge conflicts on Play data (a guest and the account both have a streak or a rating): suggested, keep the higher streak and the account's rating, adding the guest's results as history.
- Can a guest follow players (Q-P3-11), or be followed? Suggested: neither until sign-up.
