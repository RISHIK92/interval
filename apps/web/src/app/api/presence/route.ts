import { challenges, sessionReader } from "../../../server/container";
import { sameOrigin } from "../../../server/same-origin";

export const dynamic = "force-dynamic";

// P3-W17-S03 (Q-P3-16; owner, 2026-11-03): an open tab's heartbeat. The player counts as
// online for 2 minutes after it (a friend's challenge link needs its sender online), and
// a sender's tab learns here that a friend accepted. Accounts and guests (ADR-0029).
export async function POST(request: Request): Promise<Response> {
  if (!sameOrigin(request)) return new Response(null, { status: 403 });
  const actor = await sessionReader().current(request.headers);
  if (actor === null) return new Response(null, { status: 401 });
  await challenges().beat(actor.userId);
  return Response.json(
    { challenge: await challenges().pending(actor.userId) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
