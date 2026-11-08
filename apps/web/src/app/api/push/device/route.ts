import { z } from "zod";
import { forbidden } from "../../../../server/capability";
import { devicePushTokens, sessionReader } from "../../../../server/container";
import type { Actor } from "../../../../server/ports";
import { fromSiteOrApp } from "../../../../server/same-origin";

export const dynamic = "force-dynamic";

// APNs tokens are hex, FCM's letters, digits, colons, dashes and underscores.
const Token = z
  .string()
  .min(1)
  .max(4096)
  .regex(/^[A-Za-z0-9:_-]+$/);
const Register = z.object({
  platform: z.enum(["ios", "android"]),
  token: Token,
});
const Unregister = z.object({ token: Token });

// P4-W19-S04a (Q-P4-03): the app turns notifications on for this phone (Profile).
// Accounts only, as web push is.
async function account(request: Request): Promise<Actor | Response> {
  if (!fromSiteOrApp(request)) return new Response(null, { status: 403 });
  const actor = await sessionReader().current(request.headers);
  if (actor === null || actor.isGuest)
    return new Response(null, { status: 401 });
  return actor;
}

export async function POST(request: Request): Promise<Response> {
  const actor = await account(request);
  if (actor instanceof Response) return actor;
  // ADR-0036: registering needs the plan's push; removing (DELETE) stays open.
  const refused = await forbidden(actor, "push.notify");
  if (refused !== null) return refused;
  const body = Register.safeParse(await request.json().catch(() => null));
  if (!body.success) return new Response(null, { status: 400 });
  await devicePushTokens().save(
    actor.userId,
    body.data.platform,
    body.data.token,
  );
  return new Response(null, { status: 204 });
}

export async function DELETE(request: Request): Promise<Response> {
  const actor = await account(request);
  if (actor instanceof Response) return actor;
  const body = Unregister.safeParse(await request.json().catch(() => null));
  if (!body.success) return new Response(null, { status: 400 });
  await devicePushTokens().remove(actor.userId, body.data.token);
  return new Response(null, { status: 204 });
}
