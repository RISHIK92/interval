import { z } from "zod";
import { hldJudgements, sessionReader } from "../../../../../server/container";
import { forbidden } from "../../../../../server/capability";
import { feedbackView } from "../../../../hld/practice/feedback";

export const dynamic = "force-dynamic";

// P6-W41 (CANVAS-6, Q-P6-05): a player's own judgement, as the canvas shows it: the
// levels (the owner's, once an appeal is resolved), the rubric points they make, and
// the coach's advice. The canvas asks again while it's pending.
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
  const j = await hldJudgements().get(id.data, actor.userId);
  if (j === null) return new Response(null, { status: 404 });
  return Response.json(feedbackView(j), {
    headers: { "cache-control": "no-store" },
  });
}
