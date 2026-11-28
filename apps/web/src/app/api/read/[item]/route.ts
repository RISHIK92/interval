import type { ReaderResponse } from "@interval/api-client";
import { z } from "zod";
import {
  events,
  listening,
  notes,
  outboundLinks,
  quizzes,
  sessionReader,
} from "../../../../server/container";
import { attributed, countOpen } from "../../../../server/opens";
import { BIGINT_ID } from "../../../../server/ports";
import { appPlatform, fromSiteOrApp } from "../../../../server/same-origin";

export const dynamic = "force-dynamic";

// A feed card's open names its position; without one (a link from elsewhere) it is
// from=reader, which counts no card. ADR-0058: a section or chip an older app sends is
// ignored (zod drops unknown keys).
const Query = z
  .object({
    // P4-W21-S03 (§5F): a path's reading, as the web's from=path: it counts no card.
    path: z.string().regex(BIGINT_ID).optional(),
    pos: z.coerce.number().int().min(1).max(200).optional(),
  })
  .refine((q) => q.path === undefined || q.pos === undefined);

// P4-W20-S02 (ADR-0018, §3.2, ING-2): what the app's reader shows around the publisher's
// live page, read as the web reader reads it. A WebView isn't a frame, so a page that
// refuses framing opens in it too; only https does (anything else: the browser).
export async function GET(
  request: Request,
  { params }: { params: Promise<{ item: string }> },
): Promise<Response> {
  if (!fromSiteOrApp(request)) return new Response(null, { status: 403 });
  const actor = await sessionReader().current(request.headers);
  // ADR-0029: guests play, and only play.
  if (actor === null || actor.isGuest)
    return new Response(null, { status: 401 });
  const { item } = await params;
  const query = Query.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!BIGINT_ID.test(item) || !query.success)
    return new Response(null, { status: 400 });
  const { path, pos } = query.data;
  const page = await outboundLinks().reader(actor.userId, item);
  const url = page === null ? null : attributed(page.link.url);
  if (page === null || url === null) return new Response(null, { status: 404 });
  const source = appPlatform(request);
  const context = {
    ...actor,
    sessionId: null,
    ...(source === undefined ? {} : { source }),
  };
  // Not https: the app sends it to the browser, as the web's /out does, so it counts
  // as a browser open and an outbound click.
  const inApp = url.startsWith("https:");
  await countOpen(context, {
    itemId: item,
    // The app's own feed: companion links open on the web (P7-W46).
    card: pos === undefined ? null : { pos, via: "feed" },
    from:
      path !== undefined ? "path" : pos === undefined ? "reader" : undefined,
    surface: inApp ? "in_app" : "browser",
  });
  if (!inApp) events().emit("outbound_click", { target: "article" }, context);
  const allNotes = await notes().onItems(actor.userId, [item]);
  const body: ReaderResponse = {
    // P4-W20-S03 (§5D): the app's reader completes the article once its page has been
    // read to the end for about its minutes (ADR-0058: the whole page, not a section).
    measure:
      inApp && page.estimatedMinutes !== null
        ? { minutes: page.estimatedMinutes }
        : null,
    url,
    inApp,
    title: page.articleTitle,
    domain: new URL(url).hostname.replace(/^www\./, ""),
    saved: page.saved,
    state: page.state,
    note: allNotes[0]?.body ?? null,
    // As the web reader's Quiz me (P2-W9-S02).
    testable: (await quizzes().offered([item])).has(item),
    // As the web reader's Listen (P4-W23-S01).
    listen: (await listening().voiced(item)).length > 0,
  };
  return Response.json(body, { headers: { "Cache-Control": "no-store" } });
}
