import { z } from "zod";
import {
  battleResults,
  jobQueue,
  sessionReader,
} from "../../../../../server/container";
import { log } from "../../../../../server/log";
import { sameOrigin } from "../../../../../server/same-origin";

import { forbidden } from "../../../../../server/capability";

export const dynamic = "force-dynamic";

// P5-W35 (§6.5, AI-1, OPS-4; Q-P5-14, Q-P5-22): the AI code review of the player's best
// submission, after the battle, on request, once; the worker writes it.
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  if (!sameOrigin(request)) return new Response(null, { status: 403 });
  const actor = await sessionReader().current(request.headers);
  if (actor === null) return new Response(null, { status: 401 });
  // ADR-0036: the battle feature's capability, as its page asks.
  const refused = await forbidden(actor, "play.battle");
  if (refused !== null) return refused;
  const id = z.uuid().safeParse((await context.params).id);
  if (!id.success) return new Response(null, { status: 400 });
  const asked = await battleResults().requestReview(id.data, actor.userId);
  if (asked === null) return new Response(null, { status: 404 });
  if (asked === "no_code") return new Response(null, { status: 409 });
  if (asked === "requested" || asked === "pending")
    try {
      await jobQueue().enqueue(
        "review_code",
        { match_id: id.data, user_id: actor.userId },
        { idempotencyKey: `review-${id.data}-${actor.userId}` },
      );
    } catch (error) {
      // Said and thrown; the request is dropped, so the player may ask again rather
      // than wait on a review nobody will write.
      log.error("battle: review not queued", { matchId: id.data, error });
      await battleResults().dropReview(id.data, actor.userId);
      throw error;
    }
  return new Response(null, { status: 202 });
}
