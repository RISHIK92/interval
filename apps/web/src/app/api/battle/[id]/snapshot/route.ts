import { GENERATORS } from "@interval/lld";
import { z } from "zod";
import {
  battleSnapshots,
  files,
  sessionReader,
} from "../../../../../server/container";
import { log } from "../../../../../server/log";
import { sameOrigin } from "../../../../../server/same-origin";

export const dynamic = "force-dynamic";

const MATCH_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// As much code as the game server takes in a submission (services/game maxCodeBytes).
const MAX_CODE = 256 * 1024;
// The JSON around it: refused before it's read, not after.
const MAX_BODY = MAX_CODE + 4096;
const Snapshot = z.object({
  language: z.string().refine((l) => Object.hasOwn(GENERATORS, l)),
  code: z.string().max(MAX_CODE),
});

// P5-W31-S04b (§6.9, DB-6, Q-P5-17): the battle page's code every 30 s, kept in the
// private bucket for review of a fair-play flag. Only a player of the battle while it's
// open, at most every 25 s (BattleSnapshots.claim); this site only (the app has no
// battles, §6.5).
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  if (!sameOrigin(request)) return new Response(null, { status: 403 });
  const actor = await sessionReader().current(request.headers);
  if (actor === null) return new Response(null, { status: 401 });
  const { id } = await context.params;
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY)
    return new Response(null, { status: 413 });
  const text = await request.text();
  if (text.length > MAX_BODY) return new Response(null, { status: 413 });
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    // Not JSON: refused below, as any bad body is.
  }
  const parsed = Snapshot.safeParse(body);
  if (!MATCH_ID.test(id) || !parsed.success)
    return new Response(null, { status: 400 });
  const { language, code } = parsed.data;
  const key = await battleSnapshots().claim(
    id,
    actor.userId,
    language,
    new Date(),
  );
  if (key === null) return new Response(null, { status: 409 });
  try {
    await files().put(
      key,
      new TextEncoder().encode(JSON.stringify({ language, code })),
      "application/json",
    );
  } catch (error) {
    // Its row stays: the review page says the code is missing.
    log.error("battle: snapshot not stored", { matchId: id, key, error });
    throw error;
  }
  return new Response(null, { status: 204 });
}
