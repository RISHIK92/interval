import { z } from "zod";
import { asks, sessionReader } from "../../../../../server/container";
import { forbidden } from "../../../../../server/capability";
import { sameOrigin } from "../../../../../server/same-origin";

export const dynamic = "force-dynamic";

// ADR-0046: the user's own question and, once the worker wrote it, its answer; the page
// asks again while it's waiting.
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const actor = await sessionReader().current(request.headers);
  if (actor === null) return new Response(null, { status: 401 });
  if (actor.isGuest) return new Response(null, { status: 403 });
  const refused = await forbidden(actor, "explore.ask");
  if (refused !== null) return refused;
  const id = z.uuid().safeParse((await context.params).id);
  if (!id.success) return new Response(null, { status: 400 });
  const thread = await asks().get(id.data, actor.userId);
  if (thread === null) return new Response(null, { status: 404 });
  return Response.json(thread, { headers: { "cache-control": "no-store" } });
}

// ADR-0046 (retention): the user may delete any question now, with its answer and the
// follow-ups that build on it.
export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  if (!sameOrigin(request)) return new Response(null, { status: 403 });
  const actor = await sessionReader().current(request.headers);
  if (actor === null) return new Response(null, { status: 401 });
  if (actor.isGuest) return new Response(null, { status: 403 });
  const id = z.uuid().safeParse((await context.params).id);
  if (!id.success) return new Response(null, { status: 400 });
  return new Response(null, {
    status: (await asks().remove(id.data, actor.userId)) ? 204 : 404,
  });
}
