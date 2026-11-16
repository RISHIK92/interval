import { z } from "zod";
import { sessionReader } from "../../../../../../server/container";
import { forbidden } from "../../../../../../server/capability";
import { saveMatchDesign } from "../../../../../../server/hld-match-requests";
import { jsonBody } from "../../../../../../server/json-body";
import { sameOrigin } from "../../../../../../server/same-origin";

export const dynamic = "force-dynamic";

const MAX_BODY = 128 * 1024; // twice the largest design the schema allows

const Body = z.strictObject({ design: z.unknown(), base: z.unknown() });

// P6-W42 (Q-P6-03): a player's autosave in a match, over the version it was made from.
export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  if (!sameOrigin(request)) return new Response(null, { status: 403 });
  const actor = await sessionReader().current(request.headers);
  if (actor === null) return new Response(null, { status: 401 });
  const refused = await forbidden(actor, "play.hld");
  if (refused !== null) return refused;
  const id = z.uuid().safeParse((await context.params).id);
  const raw = await jsonBody(request, MAX_BODY);
  if (!raw.ok) return new Response(null, { status: raw.status });
  const body = Body.safeParse(raw.value);
  if (!id.success || !body.success) return new Response(null, { status: 400 });
  const saved = await saveMatchDesign(
    actor.userId,
    id.data,
    body.data.design,
    body.data.base,
  );
  return Response.json(saved, {
    status: saved.ok ? 200 : saved.reason === "invalid" ? 400 : 409,
  });
}
