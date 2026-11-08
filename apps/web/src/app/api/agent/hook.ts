import { z } from "zod";
import { forbidden } from "../../../server/capability";
import { agentHook, rateLimits } from "../../../server/container";
import type { Actor } from "../../../server/ports";

// P3-W17-S04 (§7, C-09): the agent hook's whole request. Only an idempotency key
// (LOAD-5): any other field, a prompt or code above all, is refused, so none can be
// sent even by mistake.
const Body = z.object({ idempotency_key: z.string().min(8).max(100) }).strict();
const MAX_BODY = 1024;
const PER_MINUTE = 30;

// The device a request comes from by its bearer token (kept only as a hash), and its
// key; or the response to send instead.
export async function hookRequest(
  request: Request,
  now: Date,
): Promise<{ deviceId: string; actor: Actor; key: string } | Response> {
  const auth = /^Bearer (ivd_[A-Za-z0-9_-]{43})$/.exec(
    request.headers.get("authorization") ?? "",
  );
  if (auth?.[1] === undefined) return new Response(null, { status: 401 });
  // A key's body is tiny; anything big is refused before it's read.
  if (Number(request.headers.get("content-length") ?? "0") > MAX_BODY)
    return new Response(null, { status: 413 });
  const body = Body.safeParse(await request.json().catch(() => null));
  if (!body.success)
    return Response.json(
      { error: "only idempotency_key is accepted" },
      { status: 400 },
    );
  const device = await agentHook().deviceFor(auth[1], now);
  if (device === null) return new Response(null, { status: 401 });
  // Two calls a task; more than this a minute is a leaked token or a loop.
  if (!(await rateLimits().allow(`agent:${device.deviceId}`, PER_MINUTE, 60)))
    return new Response(null, {
      status: 429,
      headers: { "Retry-After": "60" },
    });
  // ADR-0036: a plan without the agent hook gets nothing recorded.
  const refused = await forbidden(device.actor, "agent.hook");
  if (refused !== null) return refused;
  return { ...device, key: body.data.idempotency_key };
}
