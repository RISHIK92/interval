import { noteMax } from "@interval/api-client";
import { z } from "zod";
import { notes, sessionReader } from "../../../server/container";
import { writeNote } from "../../../server/note-writes";
import { BIGINT_ID } from "../../../server/ports";
import { appPlatform, fromSiteOrApp } from "../../../server/same-origin";

export const dynamic = "force-dynamic";

const Body = z.object({
  itemId: z.string().regex(BIGINT_ID),
  body: z.string().trim(),
});

// P4-W20-S02 (§5I, Q-P2-01): the app reader's note on the article; empty deletes it.
// ADR-0058: a section an older app sends is ignored (zod drops unknown keys).
export async function PUT(request: Request): Promise<Response> {
  if (!fromSiteOrApp(request)) return new Response(null, { status: 403 });
  const actor = await sessionReader().current(request.headers);
  if (actor === null || actor.isGuest)
    return new Response(null, { status: 401 });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return new Response(null, { status: 400 });
  const { itemId, body } = parsed.data;
  // NOTE_MAX, or the stored note's own length (noteMax).
  if (body.length > noteMax(await notes().get(actor.userId, itemId)))
    return new Response(null, { status: 400 });
  const source = appPlatform(request);
  await writeNote(
    { ...actor, sessionId: null, ...(source === undefined ? {} : { source }) },
    { itemId },
    body,
  );
  return new Response(null, { status: 204 });
}
