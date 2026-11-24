import { z } from "zod";
import { rateLimits, sessionReader } from "../../../../../../server/container";
import { forbidden } from "../../../../../../server/capability";
import { matchProgress } from "../../../../../../server/hld-match-requests";

export const dynamic = "force-dynamic";

// The page asks every 10 seconds; this leaves room for a few tabs and nothing more.
const PER_MINUTE = 30;

// Q-WD-14 (owner, 2026-11-23): how many scenarios each opponent's latest autosave
// passes, for a seated player while the match is open. Over, nothing is live (409).
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const actor = await sessionReader().current(request.headers);
  if (actor === null) return new Response(null, { status: 401 });
  const refused = await forbidden(actor, "play.hld");
  if (refused !== null) return refused;
  const id = z.uuid().safeParse((await context.params).id);
  if (!id.success) return new Response(null, { status: 400 });
  if (
    !(await rateLimits().allow(`hld-progress:${actor.userId}`, PER_MINUTE, 60))
  )
    return new Response(null, { status: 429 });
  const progress = await matchProgress(actor.userId, id.data);
  if (progress === "not_player") return new Response(null, { status: 403 });
  if (progress === "closed")
    return Response.json({ over: true }, { status: 409 });
  return Response.json(progress, { headers: { "cache-control": "no-store" } });
}
