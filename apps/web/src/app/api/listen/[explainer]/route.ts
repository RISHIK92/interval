import { z } from "zod";
import { listening, sessionReader } from "../../../../server/container";
import { finishListen, startListen } from "../../../../server/listen-flow";
import { BIGINT_ID } from "../../../../server/ports";
import { appPlatform, fromSiteOrApp } from "../../../../server/same-origin";

export const dynamic = "force-dynamic";

const Action = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start") }),
  z.object({ action: z.literal("finish") }),
  // An explainer is 60 to 120 seconds (Q-P4-11); a day is far past any.
  z.object({
    action: z.literal("position"),
    seconds: z.number().min(0).max(86_400),
  }),
]);

type Params = { params: Promise<{ explainer: string }> };

async function account(request: Request) {
  const actor = await sessionReader().current(request.headers);
  return actor === null || actor.isGuest ? null : actor;
}

// P4-W23-S01 (§5G): a queued explainer started, its place saved, or finished.
export async function POST(request: Request, { params }: Params) {
  if (!fromSiteOrApp(request)) return new Response(null, { status: 403 });
  const actor = await account(request);
  if (actor === null) return new Response(null, { status: 401 });
  const { explainer } = await params;
  const body = Action.safeParse(await request.json().catch(() => null));
  if (!BIGINT_ID.test(explainer) || !body.success)
    return new Response(null, { status: 400 });
  const source = appPlatform(request);
  const context = {
    ...actor,
    sessionId: null,
    ...(source === undefined ? {} : { source }),
  };
  const done =
    body.data.action === "start"
      ? await startListen(context, explainer)
      : body.data.action === "finish"
        ? await finishListen(context, explainer)
        : await listening().save(actor.userId, explainer, body.data.seconds);
  return new Response(null, { status: done ? 204 : 404 });
}

export async function DELETE(request: Request, { params }: Params) {
  if (!fromSiteOrApp(request)) return new Response(null, { status: 403 });
  const actor = await account(request);
  if (actor === null) return new Response(null, { status: 401 });
  const { explainer } = await params;
  if (!BIGINT_ID.test(explainer)) return new Response(null, { status: 400 });
  const removed = await listening().remove(actor.userId, explainer);
  return new Response(null, { status: removed ? 204 : 404 });
}
