import { PushPreferencesBody } from "@interval/api-client";
import {
  entitlements,
  pushSettings,
  sessionReader,
} from "../../../../server/container";
import {
  canonicalZone,
  savePushPreferences,
} from "../../../../server/push-settings";
import { appPlatform, fromSiteOrApp } from "../../../../server/same-origin";

export const dynamic = "force-dynamic";

// P4-W24-S01 (Q-P4-13): which pushes, and when; accounts on a plan with push.notify
// (ADR-0036).
async function account(request: Request) {
  const actor = await sessionReader().current(request.headers);
  return actor === null || actor.isGuest ? null : actor;
}

// A read: a same-origin GET carries no Origin, and another site can't read the answer.
export async function GET(request: Request): Promise<Response> {
  const actor = await account(request);
  if (actor === null) return new Response(null, { status: 401 });
  if (!(await entitlements().can(actor.userId, "push.notify")))
    return new Response(null, { status: 403 });
  return Response.json(await pushSettings().get(actor.userId));
}

export async function PUT(request: Request): Promise<Response> {
  if (!fromSiteOrApp(request)) return new Response(null, { status: 403 });
  const actor = await account(request);
  if (actor === null) return new Response(null, { status: 401 });
  if (!(await entitlements().can(actor.userId, "push.notify")))
    return new Response(null, { status: 403 });
  const body = PushPreferencesBody.safeParse(
    await request.json().catch(() => null),
  );
  const zone = body.success ? canonicalZone(body.data.timeZone) : null;
  if (!body.success || zone === null)
    return new Response(null, { status: 400 });
  const source = appPlatform(request);
  await savePushPreferences(
    { ...actor, sessionId: null, ...(source === undefined ? {} : { source }) },
    { ...body.data, timeZone: zone },
  );
  return new Response(null, { status: 204 });
}
