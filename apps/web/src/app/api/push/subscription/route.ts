import { z } from "zod";
import { pushEnv } from "../../../../env";
import { pushSubscriptions, sessionReader } from "../../../../server/container";
import type { Actor } from "../../../../server/ports";
import { forbidden } from "../../../../server/capability";
import { sameOrigin } from "../../../../server/same-origin";

export const dynamic = "force-dynamic";

// The browsers' push services, the only hosts a subscription may name: the worker posts
// to it, so nothing else (an internal host) may be stored. The worker checks this again
// before each push (interval_jobs/agent_push.py PUSH_HOSTS).
const PUSH_HOSTS = ["fcm.googleapis.com", "updates.push.services.mozilla.com"];
const PUSH_DOMAINS = [".push.apple.com", ".notify.windows.com"];
const pushService = (endpoint: string) => {
  const url = new URL(endpoint);
  return (
    url.port === "" &&
    (PUSH_HOSTS.includes(url.hostname) ||
      PUSH_DOMAINS.some((domain) => url.hostname.endsWith(domain)))
  );
};

// A PushSubscription's JSON as the browser gives it (keys base64url, RFC 8291).
const Endpoint = z
  .url({ protocol: /^https$/ })
  .max(2000)
  .refine(pushService);
const Subscription = z.object({
  endpoint: Endpoint,
  keys: z.object({
    p256dh: z.string().regex(/^[A-Za-z0-9_-]{87}$/),
    auth: z.string().regex(/^[A-Za-z0-9_-]{22}$/),
  }),
});
const Unsubscribe = z.object({ endpoint: Endpoint });

// P3-W17-S05b (§7, Q-P3-18; owner, 2026-11-03): "Notify me on this device" on Profile.
// Accounts only, as the agent hook is (ADR-0029); offered once VAPID keys are set.
async function account(request: Request): Promise<Actor | Response> {
  if (!sameOrigin(request)) return new Response(null, { status: 403 });
  if (pushEnv() === null) return new Response(null, { status: 503 });
  const actor = await sessionReader().current(request.headers);
  if (actor === null || actor.isGuest)
    return new Response(null, { status: 401 });
  return actor;
}

export async function POST(request: Request): Promise<Response> {
  const actor = await account(request);
  if (actor instanceof Response) return actor;
  // ADR-0036: subscribing needs the plan's web push; removing (DELETE) stays open, as
  // the endpoint is the user's data.
  const refused = await forbidden(actor, "push.notify");
  if (refused !== null) return refused;
  const body = Subscription.safeParse(await request.json().catch(() => null));
  if (!body.success) return new Response(null, { status: 400 });
  await pushSubscriptions().save(actor.userId, {
    endpoint: body.data.endpoint,
    p256dh: body.data.keys.p256dh,
    auth: body.data.keys.auth,
  });
  return new Response(null, { status: 204 });
}

export async function DELETE(request: Request): Promise<Response> {
  const actor = await account(request);
  if (actor instanceof Response) return actor;
  const body = Unsubscribe.safeParse(await request.json().catch(() => null));
  if (!body.success) return new Response(null, { status: 400 });
  await pushSubscriptions().remove(actor.userId, body.data.endpoint);
  return new Response(null, { status: 204 });
}
