# 0057. Drop the desktop companion and community-submitted questions from Phase 7

- Status: ACCEPTED (owner, 2026-11-28)
- Date: 2026-11-27
- Supersedes: none (amends docs/product.md §2, §6.8 and §7 for scope only)
- Superseded by: none

## Context

Phase 7 (docs/roadmap/overview.md: "Desktop companion, VS Code extension, community questions, institutional features") was planned in docs/roadmap/phase-7-slices.md as weeks 46–51. Weeks 46 (agent status API and hook installers, `de67e36`) and 47 (the VS Code extension, `ae29100`) are built.

The product doc describes two more surfaces:

> **Desktop companion (Phase 7):** a menubar window with time-fitted suggestions and agent status. (docs/product.md §7)

> **Community-submitted (later):** moderated, rated by players, and weighted by contributor reputation. (docs/product.md §6.8)

Weeks 48–49 (the desktop companion) were blocked on an Electron-or-Tauri decision (Q-P7-04). Week 50 (community questions, first half: email verification, submission, the second-model check and the owner's moderation queue) was built as `3dc84e6`. Week 51 (practice serving, ratings, reputation) was built but not committed.

On 2026-11-27 the owner asked, in the session, to delete weeks 50 and 51 and the desktop companion: "current web and desktop pwa is enough (rn for mobile)", meaning the web app and its installable PWA cover the desktop, and the React Native app (Phase 4) covers mobile.

## Options

### A. Drop both from scope (the owner's instruction)

- Pros: matches the owner's instruction; no fourth language (Tauri) or Electron app to build and maintain; no moderation, reputation or abuse surface to run; the PWA already gives desktop users an installable window, and `interval status` plus the VS Code extension already show agent status (W46, W47).
- Cons: no menubar window with agent status outside the editor; players can't contribute questions.
- Cost to reverse: medium. The desktop companion was never built. W50 lives in git (`3dc84e6`, reverted by the commit that records this ADR) and W51 was never committed, so community questions would be rebuilt from the plan and the owner's recorded answers (docs/questions/phase-7.md, Q-P7-05).

### B. Keep them as later work

- Pros: the product doc stays as written.
- Cons: contradicts the owner's instruction; leaves two blocked or half-built weeks in Phase 7.
- Cost to reverse: none.

## Recommendation (not a decision)

**A**, because the owner asked for it. Phase 7 is then weeks 46–47, plus institutional features once the owner defines them (Q-P7-06).

## Consequences

- **Code:** `3dc84e6` (W50) is reverted, and W51's uncommitted work is deleted. Email verification goes with W50, since it was built only to gate submissions; `app_user.email_verified` stays, always false, as before W50.
- **Migrations:** merged migrations never change (ADR-0002, checked in CI), so W50's two migrations stay as merged. `20261127200000_remove_community_questions.sql` undoes them going forward. The enum values W50 added (`questions.submit`, `questions.submit.daily`, `community`, `approve` and `reject`) stay unused, because Postgres can't drop an enum value.
- **Plan:** docs/roadmap/phase-7-slices.md marks weeks 48–51 removed. Q-P7-04 (desktop technology) and Q-P7-05 (community questions) are closed by this ADR.
- **Product doc:** §2's "Desktop companion" row, §6.8's "Community-submitted (later)" line and §7's "Desktop companion (Phase 7)" line no longer describe planned work once this is accepted. docs/product.md is not edited (CLAUDE.md); docs/conflicts.md records the amendment.
- **Unchanged:** the agent status API (W46) stays, read by `interval status` and the VS Code extension.

## Open questions

- Should `GET /api/agent/status` keep its "the extension and the desktop app" wording, or name only the CLI and the extension? This is wording only, and changes nothing in behaviour.
