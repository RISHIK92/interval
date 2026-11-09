import type { FeedSetup } from "@interval/api-client";
import { preferences, sessionReader } from "./container";
import type { EventContext } from "./events";
import { appPlatform, fromSiteOrApp } from "./same-origin";

// P4-W21-S03 (§5F): who may use the app's path routes: an account (ADR-0029: guests
// play, and only play) that has finished onboarding, as the web's Paths tab requires.
export async function pathReader(
  request: Request,
): Promise<Response | EventContext> {
  if (!fromSiteOrApp(request)) return new Response(null, { status: 403 });
  const actor = await sessionReader().current(request.headers);
  if (actor === null || actor.isGuest)
    return new Response(null, { status: 401 });
  if ((await preferences().get(actor.userId)) === null)
    return Response.json({ setup: "onboarding" } satisfies FeedSetup, {
      status: 409,
    });
  const source = appPlatform(request);
  return {
    ...actor,
    sessionId: null,
    ...(source === undefined ? {} : { source }),
  };
}
