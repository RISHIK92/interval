import type { ListenResponse } from "@interval/api-client";
import { z } from "zod";
import { listening, sessionReader } from "../../../server/container";
import { BIGINT_ID } from "../../../server/ports";
import { fromSiteOrApp } from "../../../server/same-origin";

export const dynamic = "force-dynamic";

const Queue = z.object({
  itemId: z.string().regex(BIGINT_ID),
  momentId: z.string().regex(BIGINT_ID).optional(),
});

// P4-W23-S01 (§5G, §5I): the audio queue, for accounts (guests have no reader to
// listen from, ADR-0029).
async function account(request: Request) {
  const actor = await sessionReader().current(request.headers);
  return actor === null || actor.isGuest ? null : actor;
}

// A read only: a browser sends no Origin on a same-origin GET, and another site can't
// read the answer (no CORS), so the session alone decides.
export async function GET(request: Request): Promise<Response> {
  const actor = await account(request);
  if (actor === null) return new Response(null, { status: 401 });
  const view: ListenResponse = await listening().queue(actor.userId);
  return Response.json(view);
}

// The reader's Listen: queues the voiced explainers of what it shows.
export async function POST(request: Request): Promise<Response> {
  if (!fromSiteOrApp(request)) return new Response(null, { status: 403 });
  const actor = await account(request);
  if (actor === null) return new Response(null, { status: 401 });
  const body = Queue.safeParse(await request.json().catch(() => null));
  if (!body.success) return new Response(null, { status: 400 });
  const ids = await listening().voiced(
    body.data.itemId,
    body.data.momentId ?? null,
  );
  const first = ids[0];
  if (first === undefined) return new Response(null, { status: 404 });
  await listening().add(actor.userId, ids);
  return Response.json({ first }, { status: 201 });
}
