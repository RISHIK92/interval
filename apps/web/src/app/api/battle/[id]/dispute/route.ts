import { z } from "zod";
import { battleResults, sessionReader } from "../../../../../server/container";
import { sameOrigin } from "../../../../../server/same-origin";

import { forbidden } from "../../../../../server/capability";

export const dynamic = "force-dynamic";

// P5-W35 (Q-P5-22): a player disputes a finished battle's result, once, within 7 days;
// the owner decides it at /admin/disputes. Nothing changes a rating by itself.
const Dispute = z.object({ reason: z.string().trim().min(1).max(1000) });

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
  const id = z.uuid().safeParse((await context.params).id);
  const body = Dispute.safeParse(await request.json().catch(() => null));
  if (!id.success || !body.success) return new Response(null, { status: 400 });
  const made = await battleResults().dispute(
    id.data,
    actor.userId,
    body.data.reason,
  );
  if (made === null) return new Response(null, { status: 404 });
  if (made === "late") return new Response(null, { status: 410 });
  if (made === "exists") return new Response(null, { status: 409 });
  return new Response(null, { status: 201 });
}
