import { z } from "zod";
import { books, sessionReader } from "../../../../../server/container";
import { BIGINT_ID } from "../../../../../server/ports";
import { sameOrigin } from "../../../../../server/same-origin";

export const dynamic = "force-dynamic";

const Place = z.object({
  sessionId: z.string().regex(BIGINT_ID),
  fraction: z.number().min(0).max(1),
});

// §5F (P2-W11-S04): where the reader is in their book, posted by KeepPlace. Same origin
// only, so another site can't move a signed-in reader's place.
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  if (!sameOrigin(request)) return new Response(null, { status: 403 });
  const actor = await sessionReader().current(request.headers);
  if (actor === null) return new Response(null, { status: 401 });
  const { id } = await context.params;
  const parsed = Place.safeParse(await request.json().catch(() => null));
  if (!BIGINT_ID.test(id) || !parsed.success)
    return new Response(null, { status: 400 });
  const saved = await books().savePosition(
    actor.userId,
    id,
    parsed.data.sessionId,
    parsed.data.fraction,
  );
  return new Response(null, { status: saved ? 204 : 404 });
}
