import { z } from "zod";
import {
  events,
  outboundLinks,
  sessionReader,
} from "../../../../../server/container";
import { BIGINT_ID } from "../../../../../server/ports";
import { appPlatform, fromSiteOrApp } from "../../../../../server/same-origin";

export const dynamic = "force-dynamic";

// ADR-0058: the article's page; a section an older app sends is ignored.
const Body = z.object({});

// P4-W20-S02 (§8, DB-5): the app reader's Open in browser, recorded as the web's
// /out?from=reader records it: the open is already counted, so only the click. The app
// opens the page itself (the system browser has no session for /out).
export async function POST(
  request: Request,
  { params }: { params: Promise<{ item: string }> },
): Promise<Response> {
  if (!fromSiteOrApp(request)) return new Response(null, { status: 403 });
  const actor = await sessionReader().current(request.headers);
  if (actor === null || actor.isGuest)
    return new Response(null, { status: 401 });
  const { item } = await params;
  const body = Body.safeParse(await request.json().catch(() => null));
  if (!BIGINT_ID.test(item) || !body.success)
    return new Response(null, { status: 400 });
  if ((await outboundLinks().resolve(item)) === null)
    return new Response(null, { status: 404 });
  const source = appPlatform(request);
  events().emit(
    "outbound_click",
    { target: "article" },
    { ...actor, sessionId: null, ...(source === undefined ? {} : { source }) },
  );
  return new Response(null, { status: 204 });
}
