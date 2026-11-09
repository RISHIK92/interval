import { CARD_CONTROLS } from "@interval/api-client";
import { z } from "zod";
import { forbidden } from "../../../../server/capability";
import { applyControl } from "../../../../server/card-controls";
import { sessionReader } from "../../../../server/container";
import { BIGINT_ID } from "../../../../server/ports";
import { appPlatform, fromSiteOrApp } from "../../../../server/same-origin";

export const dynamic = "force-dynamic";

const Body = z.object({
  itemId: z.string().regex(BIGINT_ID),
  control: z.enum(CARD_CONTROLS),
});

// P4-W20-S01 (§5C, Q-P1-15): the app's card menu, through the PWA's own controls.
export async function POST(request: Request): Promise<Response> {
  if (!fromSiteOrApp(request)) return new Response(null, { status: 403 });
  const actor = await sessionReader().current(request.headers);
  if (actor === null || actor.isGuest)
    return new Response(null, { status: 401 });
  // ADR-0036: no acting on a feed the plan doesn't include.
  const refused = await forbidden(actor, "feed.read");
  if (refused !== null) return refused;
  const body = Body.safeParse(await request.json().catch(() => null));
  if (!body.success) return new Response(null, { status: 400 });
  const source = appPlatform(request);
  await applyControl(actor, body.data.itemId, body.data.control, {
    ...actor,
    sessionId: null,
    ...(source === undefined ? {} : { source }),
  });
  return new Response(null, { status: 204 });
}
