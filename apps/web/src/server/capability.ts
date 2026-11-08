import { entitlements } from "./container";
import type { Capability } from "@interval/db";
import type { Actor, GameMode } from "./ports";

// ADR-0036 (OPS-3; owner, 2026-11-08): an API checks the capability of the feature it
// serves, as its page does; a plan without it gets 403 (a page answers 404).
export async function forbidden(
  actor: Actor,
  capability: Capability,
): Promise<Response | null> {
  return (await entitlements().can(actor.userId, capability))
    ? null
    : new Response(null, { status: 403 });
}

// Live play, and for a live sprint the sprint itself: its page and friend challenges
// ask both.
export async function forbiddenLive(
  actor: Actor,
  mode: GameMode,
): Promise<Response | null> {
  return (
    (await forbidden(actor, "play.live")) ??
    (mode === "sprint" ? await forbidden(actor, "play.sprint") : null)
  );
}
