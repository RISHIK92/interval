# 0016. Account-first onboarding

- Status: ACCEPTED
- Date: 2026-10-26
- Supersedes: none (amends ADR-0004's guest decisions)
- Superseded by: none

## Context

The owner's app design (docs/wireframes/app-design.html, screen 1 "Onboarding (4 steps)") shows "Account created" at the top of the first onboarding step: the account exists before onboarding. In the design pass (2026-10-26) the owner chose this over keeping guest-first.

The docs and the built Phase 1 are guest-first:

- **§5A:** "Guest-first: visitors pick topics, a level, and a break length (1–3, 3–8, or 8–15 minutes) and get a feed right away. Signing up keeps their saves and history, merging guest activity into the account."
- **ADR-0004 (ACCEPTED):** "Guests use Better Auth's anonymous users. During the private beta, guest access itself needs an invite code (Q-P1-24)." Its open item: "Guest sessions with no sign-up (Phase 1)."
- **Phase 1 Week 1:** "guest sessions that merge into accounts on sign-up".
- **Q-P1-11 (merge rules) and Q-P1-12 (a 30-day guest lifetime, inactive guests deleted)** are accepted. Q-P1-21 excludes guests from the return metric because "they have not signed up".
- **Built:**
  - P1-W1-S10 (guest sessions via `/join` with an invite code);
  - P1-W1-S11 (accounts);
  - the `purge-guests` job;
  - guest handling in events (`is_guest`), the feed's first-visit wait for new guests (ADR-0008) and the metrics (P1-W6-S04).
- **Not built:** P1-W1-S12 (guest-to-account merge), deferred.

This ADR doesn't change docs/product.md, which the owner edits. If accepted, the owner records the change to §5A.

## Decision

Accepted by the owner on 2026-10-26: option B (account first in the flow, guest code kept dormant). The open questions below still need the owner's answers before the work that depends on them.

## Options

### A. Account first, guests removed

`/join` with an invite code goes straight to sign-up (email and password), then onboarding. No anonymous users.

- **Pros:**
  - Matches the design.
  - One kind of user: the merge (W1-S12) is never needed, and the guest purge job, the `is_guest` paths and the guest exclusions in the metrics go away over time.
  - Every beta user is reachable by email.
- **Cons:**
  - Contradicts §5A and ADR-0004's guest decisions.
  - Adds friction before any value ("get a feed right away" is lost).
  - Removal work spans the web (join, sign-up, proxy, visits), the worker (`purge-guests`), events and tests.
- **Cost to reverse:** high once guests are removed: the guest path would have to be rebuilt, plus the merge.

### B. Account first in the flow, guest code kept dormant

The flow becomes sign-up, then onboarding, as drawn. The guest code stays but no screen creates guests during the beta.

- **Pros:**
  - Matches the design now.
  - Cheap to reverse: turn the guest entry back on.
  - No large removal now.
- **Cons:**
  - Dead paths stay in the code (CLAUDE.md: "no dead exports") until removed.
  - The merge question stays open.
- **Cost to reverse:** low.

### C. Keep guest-first and restyle only

Use the design's look. The "Account created" badge shows only for users who have signed up.

- **Pros:**
  - No conflict with §5A or ADR-0004.
  - The smallest change.
- **Cons:**
  - Not what the owner chose in the design pass.
  - W1-S12 is still needed.
- **Cost to reverse:** none.

## Recommendation (not a decision)

The docs support C: §5A and ADR-0004 are explicit about guest-first, and nothing in the decisions argues for an account wall. The owner's design-pass choice is account first. If that stands, **B** is the safer way to get it: it matches the design without deleting the guest path, and it keeps reversal cheap while the beta shows whether sign-up friction matters for the return metric (Q-P1-21). A follow-up removal ADR, which becomes option A, can come once that's known.

## Consequences

- **If B is accepted:**
  - `/join` (invite code) leads to sign-up, then onboarding;
  - the guest entry is switched off;
  - P1-W1-S12 (merge) is dropped from the plan, or parked;
  - ADR-0004's guest points and Q-P1-11/12 are noted as dormant;
  - §5A needs the owner's edit to say account-first.
- **The metrics:** the return metric (P1-W6-S04) covers every user, since everyone has signed up. The finished rate needs no change.
- **If A is accepted:** all of the above, plus a removal slice: anonymous plugin, `purge-guests`, `is_guest`, the new-guest feed wait (ADR-0008), and the tests.

## Open questions

- Does sign-up still need an invite code during the beta (Q-P1-24)? Presumably yes, entered on the sign-up screen.
- What about existing local guest users (one today)? Convert, delete, or leave them until they expire (30 days)?
- Does "Account created" mean email verification now? Q-P1-33 decides email delivery.
- The design shows a 4-step onboarding. With goals (ADR-0015), which steps remain: goals, topics, level, break length?
