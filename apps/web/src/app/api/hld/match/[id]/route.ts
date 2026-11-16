import { z } from "zod";
import {
  hldDeps,
  hldMatches,
  sessionReader,
} from "../../../../../server/container";
import { forbidden } from "../../../../../server/capability";
import { advance } from "../../../../../server/hld-matches";

export const dynamic = "force-dynamic";

// P6-W42 (ADR-0043): a match's phase, for its players' pages. Asking moves it on: closed
// at its deadline, scored once its judgements are in.
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
  const before = await hldMatches().get(id.data);
  if (before === null || !before.seats.some((s) => s.userId === actor.userId))
    return new Response(null, { status: 404 });
  await advance(hldDeps(), id.data);
  const after = await hldMatches().get(id.data);
  const m = after?.match;
  const phase =
    m?.scoredAt != null
      ? "scored"
      : m?.closedAt != null
        ? "judging"
        : "playing";
  return Response.json({ phase }, { headers: { "cache-control": "no-store" } });
}
