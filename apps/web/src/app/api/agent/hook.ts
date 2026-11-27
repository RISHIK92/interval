import { z } from "zod";
import { forbidden } from "../../../server/capability";
import { agentHook, rateLimits } from "../../../server/container";
import type { Actor } from "../../../server/ports";

// P3-W17-S04 (§7, C-09): the agent hook's whole request. Only an idempotency key
// (LOAD-5): any other field, a prompt or code above all, is refused, so none can be
// sent even by mistake.
const Body = z.object({ idempotency_key: z.string().min(8).max(100) }).strict();
const MAX_BODY = 1024;
// Two calls a task; more than this a minute is a leaked token or a loop.
const PER_MINUTE = 30;

// The device a request comes from by its bearer token (kept only as a hash), within
// its rate limit and on a plan with the agent hook (ADR-0036); or the response to send
// instead. P7-W46: the companion surfaces' status reads use it too, on their own limit.
export async function deviceRequest(
  request: Request,
  now: Date,
  limit: { bucket: string; perMinute: number; touch: boolean },
): Promise<{ deviceId: string; actor: Actor } | Response> {
  const token = bearer(request);
  if (token === null) return new Response(null, { status: 401 });
  return device(token, now, limit);
}

function bearer(request: Request): string | null {
  const auth = /^Bearer (ivd_[A-Za-z0-9_-]{43})$/.exec(
    request.headers.get("authorization") ?? "",
  );
  return auth?.[1] ?? null;
}

async function device(
  token: string,
  now: Date,
  limit: { bucket: string; perMinute: number; touch: boolean },
): Promise<{ deviceId: string; actor: Actor } | Response> {
  const found = await agentHook().deviceFor(token, now, limit.touch);
  if (found === null) return new Response(null, { status: 401 });
  if (
    !(await rateLimits().allow(
      `${limit.bucket}:${found.deviceId}`,
      limit.perMinute,
      60,
    ))
  )
    return new Response(null, {
      status: 429,
      headers: { "Retry-After": "60" },
    });
  // ADR-0036: a plan without the agent hook gets nothing (owner, 2026-11-27: the
  // companion surfaces share its capability).
  const refused = await forbidden(found.actor, "agent.hook");
  if (refused !== null) return refused;
  return found;
}

// The hook's start or finish: the device and its key.
export async function hookRequest(
  request: Request,
  now: Date,
): Promise<{ deviceId: string; actor: Actor; key: string } | Response> {
  const token = bearer(request);
  if (token === null) return new Response(null, { status: 401 });
  // A key's body is tiny; anything big is refused before it's read.
  if (Number(request.headers.get("content-length") ?? "0") > MAX_BODY)
    return new Response(null, { status: 413 });
  const body = Body.safeParse(await request.json().catch(() => null));
  if (!body.success)
    return Response.json(
      { error: "only idempotency_key is accepted" },
      { status: 400 },
    );
  const found = await device(token, now, {
    bucket: "agent",
    perMinute: PER_MINUTE,
    touch: true,
  });
  if (found instanceof Response) return found;
  return { ...found, key: body.data.idempotency_key };
}
