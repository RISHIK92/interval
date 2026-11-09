import { NOTE_MAX } from "@interval/api-client";
import { z } from "zod";
import { sessionReader } from "../../../server/container";
import { writeNote } from "../../../server/note-writes";
import { BIGINT_ID } from "../../../server/ports";
import { appPlatform, fromSiteOrApp } from "../../../server/same-origin";

export const dynamic = "force-dynamic";

const Body = z.object({
  itemId: z.string().regex(BIGINT_ID),
  momentId: z.string().regex(BIGINT_ID).optional(),
  body: z.string().trim().max(NOTE_MAX),
});

// P4-W20-S02 (§5I, Q-P2-01): the app reader's note on what it shows; empty deletes it.
export async function PUT(request: Request): Promise<Response> {
  if (!fromSiteOrApp(request)) return new Response(null, { status: 403 });
  const actor = await sessionReader().current(request.headers);
  if (actor === null || actor.isGuest)
    return new Response(null, { status: 401 });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return new Response(null, { status: 400 });
  const { itemId, momentId, body } = parsed.data;
  const source = appPlatform(request);
  await writeNote(
    { ...actor, sessionId: null, ...(source === undefined ? {} : { source }) },
    { itemId, momentId: momentId ?? null },
    body,
  );
  return new Response(null, { status: 204 });
}
