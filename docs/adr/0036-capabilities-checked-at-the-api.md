# 0036. Capabilities are checked where a feature is served, not only on its page

- Status: PROPOSED
- Date: 2026-11-08
- Supersedes: none
- Superseded by: none

## Context

OPS-3 (docs/decisions.md): "An entitlements layer from Phase 1. Features check capabilities, so plans can be added later through configuration."

The drift audit of 2026-11-07 (docs/audits/2026-11-07.md, "Invariant violations") found that live play is gated only on its pages:

- `play.live` is checked in `apps/web/src/app/play/page.tsx`, `play/live/sprint/page.tsx` and `play/challenge/*`.
- The route handlers that do the work check only for a session:
  - `apps/web/src/app/api/game/queue/route.ts` (join, poll, leave);
  - `api/game/bot/route.ts` (a ghost or bot match);
  - `api/game/ticket/route.ts` (the game server's ticket).
- No route handler in `apps/web/src/app/api` calls `entitlements().can` at all.

A user whose plan lacks `play.live` can therefore play live by calling the APIs directly. Today every plan grants it, so nothing leaks yet. The gap opens the day a plan without it exists, which is exactly what OPS-3 is for.

The same audit lists surfaces with no capability of their own:

- the agent hook (`/api/agent/*`, device tokens);
- web push subscriptions;
- follows;
- country and university.

`ai.notes.daily` is seeded in `plan_capability` but never enforced outside tests and the worker's in-memory fake.

Native apps arrive in Phase 4 (P4-W19-S03 onwards). They call these APIs directly, with no page in between, which makes page-only gating a real hole rather than a theoretical one.

## Options

### A. Every route handler (and server action) that serves a gated feature checks its capability; new surfaces get capabilities as they are touched

- **What:** one guard used by route handlers, mirroring the pages' `requireAdmin`/capability checks. It answers 403 when the actor's plan lacks the capability.
  - The game routes check `play.live`.
  - The quiz and game actions check `play.sprint`, `play.estimation` and `play.daily`, as their pages already do.
- **Pros:**
  - OPS-3 holds wherever a feature can be reached, including the native app;
  - the check sits next to the work;
  - one small guard, tested once.
- **Cons:**
  - every gated route gains a lookup (a cached capability read per request);
  - existing route tests need an entitlements fake.
- **Cost to reverse:** low; removing the guard restores today's behaviour.

### B. Keep page-only gating and record it as an accepted exception

- **Pros:** nothing to build.
- **Cons:**
  - OPS-3 is met only for browsers that follow links;
  - the native app and any script bypass it;
  - a future plan without `play.live` would not actually be limited.
- **Cost to reverse:** low now, higher once plans differ and users rely on the gap.

### C. A middleware that maps URL prefixes to capabilities

- **Pros:** one place lists every gated path.
- **Cons:**
  - Next.js middleware runs on the edge without the database adapters (ADR-0012 ports);
  - a mapping by path drifts from the routes it guards;
  - server actions aren't URL-addressed in a stable way.
- **Cost to reverse:** medium.

## Recommendation (not a decision)

**A.** OPS-3 says features check capabilities, and a feature is served by its route handler, not by the page that links to it. Phase 4's native app makes the gap reachable. The guard is small and follows the pattern the pages already use.

For the surfaces with no capability yet, add one only when a plan could reasonably differ on it:

- the agent hook: `agent.hook`;
- web push: `push.notify`.

Follows and country or university are profile data with no cost (OPS-4) and no plan reason to differ, so they stay ungated. For `ai.notes.daily`, enforce it where notes are generated (the worker's notes stage already has the port), or remove it from the seed if the owner no longer wants a daily limit on notes.

What would change this: if plans are never going to differ (a single plan for good), B costs nothing and A is ceremony.

## Consequences

If accepted:

- **A route guard** (for example `requireCapability(actor, capability)` returning a 403 response) used by:
  - `api/game/queue`, `api/game/bot` and `api/game/ticket` (`play.live`);
  - the quiz and game server actions (their game's capability);
  - `/api/agent/*` and `/api/push/subscription` (new capabilities).
- **A migration** adds `agent.hook` and `push.notify` to the `capability` enum and grants them in the beta plan, so nothing changes for current users.
- **Tests:** a user without the capability gets 403 from each guarded route.
- **The decision on `ai.notes.daily`** is recorded with it (enforced or removed).
- **Native slices** (P4-W20 onwards) inherit the guard from the routes they call.

## Open questions

- Should a missing capability on a page and on its API answer the same way (404 on pages today, 403 on APIs)?
- `ai.notes.daily`: enforce the daily limit in the worker, or drop the capability?
