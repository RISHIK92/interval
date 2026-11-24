import { GENERATORS } from "@interval/lld";
import { z } from "zod";
import { battleCode, sessionReader } from "../../../../../server/container";
import { forbidden } from "../../../../../server/capability";
import { sameOrigin } from "../../../../../server/same-origin";

export const dynamic = "force-dynamic";

const MATCH_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// As much code as the game server takes in a submission (services/game maxCodeBytes),
// in bytes, as battle_code's column holds it.
const MAX_CODE_BYTES = 256 * 1024;
// The JSON around it, in bytes: refused from its length, or as it's read past it.
const MAX_BODY = MAX_CODE_BYTES + 4096;
const Saved = z.object({
  language: z.string().refine((l) => Object.hasOwn(GENERATORS, l)),
  code: z.string(),
});

// Q-WD-17 (owner, 2026-11-23): one file per language, autosaved on the server. The
// battle page sends a language's code a couple of seconds after its last edit; only a
// player of the battle while it's open (BattleCode.save). Fair-play snapshots are the
// snapshot route's, apart.
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  if (!sameOrigin(request)) return new Response(null, { status: 403 });
  const actor = await sessionReader().current(request.headers);
  if (actor === null) return new Response(null, { status: 401 });
  // ADR-0036: the battle feature's capability, as its page asks.
  const refused = await forbidden(actor, "play.battle");
  if (refused !== null) return refused;
  const { id } = await context.params;
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY)
    return new Response(null, { status: 413 });
  const text = await bodyUpTo(request, MAX_BODY);
  if (text === null) return new Response(null, { status: 413 });
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    // Not JSON: refused below, as any bad body is.
  }
  const parsed = Saved.safeParse(body);
  if (!MATCH_ID.test(id) || !parsed.success)
    return new Response(null, { status: 400 });
  const { language, code } = parsed.data;
  if (new TextEncoder().encode(code).length > MAX_CODE_BYTES)
    return new Response(null, { status: 413 });
  const saved = await battleCode().save(
    id,
    actor.userId,
    language,
    code,
    new Date(),
  );
  return new Response(null, { status: saved ? 204 : 409 });
}

// The body as text, read only up to `max` bytes: one sent without a length (chunked)
// is cut off there rather than read whole. Null when it's longer.
async function bodyUpTo(request: Request, max: number): Promise<string | null> {
  if (request.body === null) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.byteLength;
  }
  return new TextDecoder().decode(all);
}
