# 0056. Open sign-up: no invite code, no beta group for new users

- Status: ACCEPTED (owner, 2026-11-26)
- Date: 2026-11-26
- Supersedes: none (amends Q-P1-24's answer, and the invite rules in ADR-0004, ADR-0016 and ADR-0029)
- Superseded by: none

Accepted by the owner's own answers in the session of 2026-11-26, recorded verbatim:

- "let users signup/signin without join code"
- on the beta group: "no beta group, direct production"
- on guests: "Yes, guests too"

## Context

Q-P1-24 (docs/questions/phase-1.md) made the product invite-only. The owner's answer (2026-10-25): "An invite code is required for any access during the private beta, including guest mode. The code sets the group (student or developer). Added 2026-10-25: when a guest signs up, the account reuses the guest's code and group; no second use is consumed." Its suggested default also fixed that "`beta_group` is on the user row and copied into every event." The Phase 1 roadmap asks for "invite codes for the two beta groups" and "Athena queries split by beta group" (docs/roadmap/phase-1.md).

The accepted ADRs repeat the rule:

- **ADR-0004:** "Guests use Better Auth's anonymous users. During the private beta, guest access itself needs an invite code (Q-P1-24)."
- **ADR-0016:** "`/join` (invite code) leads to sign-up, then onboarding"; its open question, "Does sign-up still need an invite code during the beta (Q-P1-24)? Presumably yes, entered on the sign-up screen."
- **ADR-0029:** the open question "During the private beta, does a guest still need an invite code (Q-P1-24)? Suggested: yes on the landing entry; a challenge link counts as the sender's invite", answered by the owner (docs/questions/phase-3.md): "the landing page's Play entry asks for an invite code; a challenge link counts as the sender's invite (same group, no code use spent)."

The schema enforces it: `app_user.beta_group` and `app_user.invite_code_id` are `not null` ("No user without a redeemed invite code, and the code sets the group", migration 20261025040000), and the event envelope's `beta_group` is a required `student | developer`.

The owner now ends the private beta: anyone may sign up, sign in and play as a guest with no code, and new users have no beta group.

## Options

### A. Open sign-up, no group for new users (chosen)

Sign-up (`/join`), sign-in and a guest start need no code. A new user's `beta_group` is null; existing users keep theirs. A `/join?code=` link still works: a valid code still sets its group and spends a use.

- Pros: the owner's answer; no form field for a group nobody is asked about; nothing about existing users or their events changes; codes already handed out keep working.
- Cons: "Athena queries split by beta group" now has a third, ungrouped bucket that will grow to most users; the code's use limit no longer throttles account or guest creation, so per-network limits carry that alone.
- Cost to reverse: low. The column only becomes nullable; requiring a code again is a form field and a check.

### B. Open sign-up, ask the group at sign-up

No code, but the sign-up form asks "student or developer".

- Pros: keeps the metric split for every user.
- Cons: the owner said "no beta group"; a self-declared group isn't the cohort the code made; one more question at sign-up.
- Cost to reverse: low.

### C. Keep invite-only

- Pros: no change; codes still throttle sign-ups.
- Cons: contrary to the owner's answer.
- Cost to reverse: none.

## Recommendation (not a decision)

**A**, as the owner answered. B would invent a group the owner said to drop; C keeps a gate the owner removed.

## Consequences

- **Schema:** a migration makes `app_user.beta_group` and `app_user.invite_code_id` nullable, with a check that they are null together (a group only ever comes from a code). The composite key to `invite_code` stays, so a user with a code still has that code's group.
- **Sign-up (`/join`):** name, email and password; no code field. A code from a `/join?code=` link rides along hidden: a valid one sets the group (backwards compatibility for links already sent), and one that is unknown, expired or used up no longer blocks: the account is made without a group, and the log says why. Accounts made at `/join` are limited per network (the code's use count was the only throttle there).
- **Guests:** the Play entry and challenge links (which send a visitor without a session to Play) start a guest with no code and no group. The per-browser rule and the network's daily guest limit (P3-W13-S07) stay and are now the only throttle. A guest who signs up keeps its saves (§5A) and its (null) group, as before.
- **Sign-in:** unchanged; it never needed a code.
- **Events (DB-5):** the envelope's `beta_group` may be null. Already-written events are unchanged.
- **Metric queries:** users with no group are counted in their own `none` bucket, never dropped.
- **Invite codes:** the table, the worker's `issue-invites` command and the codes already issued stay; they are optional now.
- **Copy:** "invite-only", "private beta" and "invite code" wording leaves the web and mobile sign-up, sign-in, join and Play pages.
- docs/product.md and docs/decisions.md aren't changed by this ADR; the owner records it. Q-P1-24's answer stays as history.

## Open questions

- With no code, anyone can learn whether an email has an account from `/join`'s "already exists" answer (30 tries an hour per network); forgot-password's "No account with that email." already tells the same. Keep both, or answer the same either way?
- If Valkey is down, `/join` fails rather than make accounts unthrottled. Is that the wanted trade-off?
- The per-network limit on new accounts (30 an hour from one network) is a starting number; the owner may set another.
