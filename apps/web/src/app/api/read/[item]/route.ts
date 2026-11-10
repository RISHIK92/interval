import { CHIPS, type ReaderResponse } from "@interval/api-client";
import { z } from "zod";
import {
  events,
  listening,
  notes,
  outboundLinks,
  quizzes,
  sessionReader,
} from "../../../../server/container";
import { attributed, countOpen, sectionMarker } from "../../../../server/opens";
import { BIGINT_ID, quizKey, type ReaderPage } from "../../../../server/ports";
import { appPlatform, fromSiteOrApp } from "../../../../server/same-origin";

export const dynamic = "force-dynamic";

// A feed card's open names its chip and position, and so does Next section from it
// (counted like one, owner 2026-10-26); without them (a link from elsewhere) it is
// from=reader, which counts no card.
const Query = z
  .object({
    moment: z.string().regex(BIGINT_ID).optional(),
    chip: z.enum(CHIPS).optional(),
    // P4-W21-S03 (§5F): a path's reading, as the web's from=path: it counts no card.
    path: z.string().regex(BIGINT_ID).optional(),
    pos: z.coerce.number().int().min(1).max(200).optional(),
  })
  .refine((q) => (q.chip === undefined) === (q.pos === undefined))
  .refine((q) => q.path === undefined || q.chip === undefined);

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
  const { moment, chip, pos } = query.data;
  const page = await outboundLinks().reader(actor.userId, item, moment ?? null);
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
    momentId: moment,
    link: page.link,
    card: chip === undefined || pos === undefined ? null : { chip, pos },
    from:
      query.data.path !== undefined
        ? "path"
        : chip === undefined
          ? "reader"
          : undefined,
    surface: inApp ? "in_app" : "browser",
  });
  if (!inApp)
    events().emit(
      "outbound_click",
      { link_type: page.link.linkType, target: "section" },
      context,
    );
  // The section really reached; a link that fell back is the article (as /out says).
  const reached = page.link.linkType === "article" ? null : (moment ?? null);
  const body: ReaderResponse = {
    measure: measure(page, reached, inApp),
    url,
    inApp,
    title:
      page.sectionTitle === null || page.sectionTitle === page.articleTitle
        ? page.articleTitle
        : `${page.sectionTitle} — ${page.articleTitle}`,
    domain: new URL(url).hostname.replace(/^www\./, ""),
    saved: page.saved,
    reached,
    nextMomentId: page.nextMomentId,
    note: await notes().get(actor.userId, item, reached),
    // As the web reader's Test me (P2-W9-S02).
    testable: (
      await quizzes().offered([{ itemId: item, momentId: reached }])
    ).has(quizKey(item, reached)),
    // As the web reader's Listen (P4-W23-S01).
    listen: (await listening().voiced(item, reached)).length > 0,
  };
  return Response.json(body, { headers: { "Cache-Control": "no-store" } });
}

// P4-W20-S03 (§5D, owner 2026-11-09): a section the app's reader can measure: shown in
// the app, reached, with a findable start, and an end unless it is the last section.
function measure(
  page: ReaderPage,
  reached: string | null,
  inApp: boolean,
): ReaderResponse["measure"] {
  if (!inApp || reached === null || page.estimatedMinutes === null) return null;
  const start = sectionMarker(page.link.url);
  const end = page.nextLink === null ? null : sectionMarker(page.nextLink);
  if (start === null || (page.nextLink !== null && end === null)) return null;
  return { start, end, minutes: page.estimatedMinutes };
}
