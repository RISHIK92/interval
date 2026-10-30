import { cookies } from "next/headers";
import { z } from "zod";
import { CHIPS } from "../../server/chips";
import { events, outboundLinks, sessionReader } from "../../server/container";
import { log } from "../../server/log";
import { attributed, countOpen } from "../../server/opens";
import { BIGINT_ID } from "../../server/ports";
import { formatReading, READING_COOKIE } from "../../server/reading";
import { visitCookieOptions, visitId } from "../../server/visits";
import { env } from "../../env";

export const dynamic = "force-dynamic";

const Open = z.object({
  item: z.string().regex(BIGINT_ID),
  moment: z.string().regex(BIGINT_ID).optional(),
  // A feed card has a chip and position. A Continue link (continue_clicked) and a
  // Library link (an outbound click only, the whole article) need neither; a chip
  // sent with them is ignored (owner, 2026-10-26).
  chip: z.enum(CHIPS).optional(),
  pos: z.coerce.number().int().min(1).max(200).optional(),
  // "reader": Open in browser from inside the in-app reader, after a move there
  // (ADR-0018); it records the section and the outbound click only.
  // "path": a path's reading (P2-W10-S03), counted as a Library open is.
  from: z.enum(["continue", "library", "reader", "path"]).optional(),
  target: z.enum(["section", "original"]),
});

// Relative: behind CloudFront and the ALB the app sees http, so an absolute URL built
// from the request would downgrade the reader.
function home(): Response {
  return new Response(null, { status: 302, headers: { location: "/" } });
}

// "Read article" and "Open original website" (§3.2, §5D, P1-W5-S01): record the open,
// then send the reader to the publisher, attributed (§8). Works without scripts. A GET:
// another site could send a signed-in reader here and count an open, in the analytics
// and, for an explored entry, once in its arm's shown count (exploration only).
export async function GET(request: Request): Promise<Response> {
  const query = new URL(request.url).searchParams;
  const parsed = Open.safeParse(Object.fromEntries(query));
  if (!parsed.success) return home();
  const { item, moment, chip, pos, from, target } = parsed.data;
  const card =
    from === undefined && pos !== undefined && chip !== undefined
      ? { chip, pos }
      : null;
  if (card === null && (from === undefined || pos !== undefined)) return home();
  const link = await outboundLinks().resolve(
    item,
    target === "section" ? (moment ?? null) : null,
  );
  if (link === null) return home();
  const publisher = attributed(link.url);
  if (publisher === null) {
    log.warn("out: stored link is not http(s)", {
      item,
      linkType: link.linkType,
    });
    return home();
  }
  const actor = await sessionReader().current(request.headers);
  if (actor !== null) {
    const jar = await cookies();
    const context = { ...actor, sessionId: visitId(jar) };
    // For the feed's Now reading panel (C-22): a session cookie, ids only.
    const session = {
      ...visitCookieOptions(env().BETTER_AUTH_URL),
      maxAge: undefined,
    };
    // Not for a Library or path open: the panel is about what the feed sent you to
    // (owner). Nor for a guest, whose reading isn't tracked (ADR-0029: guests play).
    if (from !== "library" && from !== "path" && !actor.isGuest)
      jar.set(
        READING_COOKIE,
        formatReading({
          itemId: item,
          // The moment only when the reader really reached it, not a fallback.
          momentId: link.linkType === "article" ? null : (moment ?? null),
        }),
        session,
      );
    if (!actor.isGuest)
      await countOpen(context, {
        itemId: item,
        momentId: moment,
        link,
        card,
        from,
        surface: "browser",
      });
    events().emit(
      "outbound_click",
      { link_type: link.linkType, target },
      context,
    );
  }
  return new Response(null, { status: 302, headers: { location: publisher } });
}
