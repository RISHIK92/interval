import { z } from "zod";
import {
  hldJudgements,
  sessionReader,
} from "../../../../../../server/container";
import { forbidden } from "../../../../../../server/capability";
import { sameOrigin } from "../../../../../../server/same-origin";

export const dynamic = "force-dynamic";

const Body = z.strictObject({ reason: z.string().trim().min(1).max(500) });

// P6-W41 (CANVAS-6, Q-P6-05): a player appeals the judge's levels: once, within 7 days,
// with a short reason. The owner re-grades at /admin/hld-appeals.
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  if (!sameOrigin(request)) return new Response(null, { status: 403 });
  const actor = await sessionReader().current(request.headers);
  if (actor === null) return new Response(null, { status: 401 });
  const refused = await forbidden(actor, "play.hld");
  if (refused !== null) return refused;
  const id = z.uuid().safeParse((await context.params).id);
  const body = Body.safeParse(await request.json().catch(() => null));
  if (!id.success || !body.success) return new Response(null, { status: 400 });
  const done = await hldJudgements().appeal(
    id.data,
    actor.userId,
    body.data.reason,
    new Date(),
  );
  if (done === null) return new Response(null, { status: 404 });
  if (done !== "appealed")
    return Response.json({ refused: done }, { status: 409 });
  return new Response(null, { status: 204 });
}
