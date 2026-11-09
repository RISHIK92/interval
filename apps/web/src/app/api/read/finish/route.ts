import { z } from "zod";
import { sessionReader } from "../../../../server/container";
import { finishReading } from "../../../../server/finish";
import { BIGINT_ID } from "../../../../server/ports";
import { appPlatform, fromSiteOrApp } from "../../../../server/same-origin";

export const dynamic = "force-dynamic";

const Body = z.object({
  itemId: z.string().regex(BIGINT_ID),
  momentId: z.string().regex(BIGINT_ID).optional(),
});

// P4-W20-S02 (§5D, ADR-0018): the app reader's Mark done, as the web reader's.
export async function POST(request: Request): Promise<Response> {
  if (!fromSiteOrApp(request)) return new Response(null, { status: 403 });
  const actor = await sessionReader().current(request.headers);
  if (actor === null || actor.isGuest)
    return new Response(null, { status: 401 });
  const body = Body.safeParse(await request.json().catch(() => null));
  if (!body.success) return new Response(null, { status: 400 });
  const source = appPlatform(request);
  await finishReading(
    { ...actor, sessionId: null, ...(source === undefined ? {} : { source }) },
    body.data.itemId,
    body.data.momentId,
    "mark_done",
  );
  return new Response(null, { status: 204 });
}
