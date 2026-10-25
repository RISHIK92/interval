# 0004. Auth provider and guest sessions

- Status: ACCEPTED
- Date: 2026-10-25
- Supersedes: none
- Superseded by: none

## Decision (owner, 2026-10-25)

Better Auth, a library with users stored in Interval's Postgres. This is the Auth.js-style option (B), with Better Auth chosen over Auth.js for its anonymous-user plugin, account linking and Expo integration.
- This deviates from OPS-1 "Managed auth (Cognito or equivalent)". This ADR overrides OPS-1 on the auth provider only; SES and Secrets Manager parts of OPS-1 stand.
- Phase 1 sign-in: email + password, with a password reset flow. Auth email goes to a local log in development and through SES at beta.
- Guests use Better Auth's anonymous users. During the private beta, guest access itself needs an invite code (Q-P1-24).
- Guest sessions: 30-day sliding lifetime; inactive guests deleted after 30 days (Q-P1-12).
- Merge rules: Q-P1-11 defaults accepted.
- Still open: whether GitHub is also a sign-in method in Phase 2.

## Context

- OPS-1: "Managed auth (Cognito or equivalent). SES sends university verification codes. Secrets Manager holds credentials."
- §5A: "Guest-first: visitors pick topics, a level, and a break length ... and get a feed right away. Signing up keeps their saves and history, merging guest activity into the account. Connecting GitHub is optional. University verification uses a one-time code sent to a college email address."
- Phase 1 Week 1: "the Next.js shell and auth"; "guest sessions that merge into accounts on sign-up".
- Phase 2 Week 12: GitHub (repository metadata and dependency files, §5H). Phase 3 Week 14: university verification via SES. Phase 4 Week 19: Expo auth.
- C-28: the HTML says users can export or delete their data. Oct 23 is silent.

Requirements, in phase order:
1. Guest sessions with no sign-up (Phase 1).
2. Merge guest activity into a new or existing account (Phase 1). See Q-P1-11.
3. Email sign-up and sign-in (Phase 1; the method is not specified, see open questions).
4. GitHub OAuth with repository read scope (Phase 2). This is both a sign-in method and a data connection.
5. College-email verification by one-time code through SES (Phase 3). This verifies an affiliation, not a login, so any provider works; the code flow is app-owned.
6. Expo support (Phase 4).
7. Low cost at ~60 beta users, few moving parts, AWS-native where possible.

Guest sessions are app-owned in every option: no listed provider stores Interval's guest saves and history. The guest is a row in Postgres keyed by a signed, httpOnly cookie, and merge is app SQL. The provider choice affects accounts, OAuth, tokens and Expo.

## Options

### A. Amazon Cognito user pools (with app-owned guests)

- Guests: app-owned. Cognito identity pools offer unauthenticated identities, but those give AWS credentials, not app sessions; not useful here.
- Merge: app-owned, on the post-sign-up callback.
- GitHub: GitHub is OAuth 2.0 without OIDC, so it does not plug into Cognito as a social provider directly. Options are an OIDC shim or treating GitHub as a separate connection (not a sign-in method) using GitHub's OAuth app flow in the Next.js app. The second is simpler and matches §5H, where GitHub is a data permission.
- SES: native integration for Cognito email; university codes are app-owned either way.
- Expo: works through the hosted UI and `expo-auth-session`, or Amplify libraries.
- Cost: free tier covers far beyond beta scale (verify current Cognito pricing tiers before accepting).
- Lock-in: medium. User pool passwords cannot be exported; migration needs a lazy-migration Lambda or password resets.
- Fit: named in OPS-1. CDK-native (ARCH-4). Secrets in Secrets Manager.

### B. Auth.js (NextAuth) with the Postgres adapter

- Guests: app-owned. No built-in anonymous user.
- Merge: app-owned.
- GitHub: first-class provider.
- SES: email magic links through an SES transport.
- Expo: weak. Auth.js targets Next.js; a mobile client needs a custom token endpoint.
- Cost: none beyond RDS.
- Lock-in: low. Users live in your Postgres.
- Fit: a library, not managed auth. OPS-1 says "managed auth"; this would be a deviation needing acceptance. Security fixes and session handling become your job.

### C. Clerk (managed, third party)

- Guests: app-owned (no anonymous users in the sense needed here; verify).
- Merge: app-owned, on the user-created webhook or first authenticated request.
- GitHub: first-class.
- SES: not used for auth email (Clerk sends its own). University codes stay app-owned through SES.
- Expo: first-class SDK.
- Cost: free tier covers beta scale; paid per MAU later (verify current pricing).
- Lock-in: medium to high. User data lives outside AWS; webhooks keep a local users table in sync.
- Fit: "or equivalent" in OPS-1. Adds an external vendor and a webhook path.

### D. Firebase Authentication or Supabase Auth (anonymous users built in)

- Guests: provider-native anonymous users, later linked to a real identity. This handles the identity side of merge, but saves and history still live in Interval's Postgres.
- GitHub, Expo: supported.
- Cost: low at beta scale.
- Lock-in: medium; non-AWS vendor; a second platform to operate.
- Fit: weakest with "AWS managed services" (Part II context).

## Recommendation (not a decision)

Option A, Cognito user pools, with:
- app-owned guest sessions (signed cookie → `guest` row in Postgres),
- app-owned merge on first authenticated request after sign-up,
- GitHub as a separate data connection in Phase 2, not a Cognito identity provider.

Reasons: OPS-1 names Cognito; it is AWS-native and CDK-managed (ARCH-4); and guest handling and merge are app logic under every option, so a third-party provider buys little in Phase 1. Revisit if Cognito's hosted UI blocks a usable onboarding flow, or if Expo integration proves painful in Phase 4.

## Consequences

- Phase 1 needs a Cognito user pool, an app client, and a custom domain or hosted UI decision.
- A guest session table, a cookie signing secret in Secrets Manager, and a merge routine with tests for every case in Q-P1-11.
- Every user-owned table keys on an internal `user_id` that is the same for guest and account, so merge relabels one row, not every table. This needs the merge-conflict rules first (Q-P1-11).
- Sign-up method (email + password, magic link, or both) is still open.

## Open questions

- Sign-in methods in Phase 1: email + password, email code, or Google too? Suggested default: email + password and email code via Cognito; no social sign-in until GitHub in Phase 2.
- Should GitHub also be a sign-in method in Phase 2, or only a connection? Suggested default: connection only.
- Guest session lifetime and cleanup (Q-P1-12).
