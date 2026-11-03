import { z } from "zod";
import {
  agentHook,
  challenges,
  sessionReader,
} from "../../../server/container";
import { sameOrigin } from "../../../server/same-origin";

export const dynamic = "force-dynamic";

// The page open, as a place on this site the player could come back to (P3-W17-S04): a
// path, never Home itself, another site, an API or a challenge link (taken once).
const Place = z
  .string()
  .max(300)
  .regex(/^\/(?![/\\])[^\s\\]+$/)
  .refine((path) => !/^\/(api|c)(\/|$|\?)/.test(path));
// `arrived`: the tab's page changed since its last beat (a real visit, not the page
// already open when an agent finished).
const Body = z
  .object({
    page: z.string().max(2048).optional(),
    arrived: z.boolean().optional(),
  })
  .strict();

// P3-W17-S03, S04 (Q-P3-16, Q-P3-28; owner, 2026-11-03): an open tab's heartbeat. The
// player counts as online for 2 minutes after it (a friend's challenge link needs its
// sender online); a page that can be a place is kept, for an agent's "finished" to save,
// and arriving at the saved place clears it. A page that can't be one still beats. A
// sender's tab learns here that a friend accepted, and anyone's that their agent
// finished. Accounts and guests (ADR-0029).
export async function POST(request: Request): Promise<Response> {
  if (!sameOrigin(request)) return new Response(null, { status: 403 });
  const body = Body.safeParse(await request.json().catch(() => ({})));
  if (!body.success) return new Response(null, { status: 400 });
  const actor = await sessionReader().current(request.headers);
  if (actor === null) return new Response(null, { status: 401 });
  const place = Place.safeParse(body.data.page).data;
  await challenges().beat(actor.userId, place);
  if (place !== undefined && body.data.arrived === true)
    await agentHook().openedPlace(actor.userId, place, new Date());
  const [challenge, agentFinished] = await Promise.all([
    challenges().pending(actor.userId),
    challenges().takeAgentFinished(actor.userId),
  ]);
  return Response.json(
    { challenge, agentFinished },
    { headers: { "Cache-Control": "no-store" } },
  );
}
