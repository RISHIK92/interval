import { cookies } from "next/headers";
import {
  asks,
  entitlements,
  events,
  jobQueue,
  sessionReader,
} from "../../../../server/container";
import { forbidden } from "../../../../server/capability";
import { AskBody, submitAsk } from "../../../../server/explore";
import { jsonBody } from "../../../../server/json-body";
import { sameOrigin } from "../../../../server/same-origin";
import { visitId } from "../../../../server/visits";

export const dynamic = "force-dynamic";

// Far above a 300-character question and its key.
const MAX_BYTES = 4 * 1024;

// ADR-0046: "Ask anything". Checked here (the capability, today's count and the AI
// budgets), stored, and queued for the worker, which answers; the page asks again
// until it has. A retried submit with the same key is the same question (LOAD-5).
export async function POST(request: Request): Promise<Response> {
  if (!sameOrigin(request)) return new Response(null, { status: 403 });
  const actor = await sessionReader().current(request.headers);
  if (actor === null) return new Response(null, { status: 401 });
  // ADR-0029: guests play, and only play.
  if (actor.isGuest) return new Response(null, { status: 403 });
  const refused = await forbidden(actor, "explore.ask");
  if (refused !== null) return refused;
  const body = await jsonBody(request, MAX_BYTES);
  if (!body.ok) return new Response(null, { status: body.status });
  const parsed = AskBody.safeParse(body.value);
  if (!parsed.success) return new Response(null, { status: 400 });
  const result = await submitAsk(
    {
      asks: asks(),
      entitlements: entitlements(),
      queue: jobQueue(),
      events: events(),
    },
    { ...actor, sessionId: visitId(await cookies()) },
    parsed.data,
    new Date(),
  );
  switch (result.status) {
    case "queued":
      return Response.json({ id: result.id }, { status: 202 });
    case "refused":
      return Response.json({ refused: result.reason }, { status: 429 });
    case "thread_full":
      return Response.json({ refused: "thread_full" }, { status: 409 });
    case "no_thread":
      return new Response(null, { status: 404 });
  }
}
