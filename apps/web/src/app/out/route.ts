import { cookies } from "next/headers";
import { z } from "zod";
import { CHIPS } from "../../server/chips";
import { events, outboundLinks, sessionReader } from "../../server/container";
import { log } from "../../server/log";
import { BIGINT_ID } from "../../server/ports";
import { formatReading, READING_COOKIE } from "../../server/reading";
import { visitCookieOptions, visitId } from "../../server/visits";
import { env } from "../../env";

export const dynamic = "force-dynamic";

const Open = z.object({
  item: z.string().regex(BIGINT_ID),
  moment: z.string().regex(BIGINT_ID).optional(),
  chip: z.enum(CHIPS),
  pos: z.coerce.number().int().min(1).max(200).optional(),
  // A Continue link after a finish (owner, 2026-10-26): no feed position.
  from: z.literal("continue").optional(),
  target: z.enum(["section", "original"]),
});

// Relative: behind CloudFront and the ALB the app sees http, so an absolute URL built
// from the request would downgrade the reader.
function home(): Response {
  return new Response(null, { status: 302, headers: { location: "/" } });
}

// The publisher's page with utm_source=interval added (§8): appended as is, never
// re-encoding the publisher's own query, and before the fragment, so a section link
// still lands on its section. Null unless it is an http(s) URL: links come from feeds.
function attributed(stored: string): string | null {
  let url: URL;
  try {
    url = new URL(stored);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const hash = stored.indexOf("#");
  const base = hash === -1 ? stored : stored.slice(0, hash);
  const fragment = hash === -1 ? "" : stored.slice(hash);
  return `${base}${base.includes("?") ? "&" : "?"}utm_source=interval${fragment}`;
}

// "Read on site" and "Open original website" (§3.2, §5D, P1-W5-S01): record the open,
// then send the reader to the publisher, attributed (§8). Works without scripts. A GET:
// another site could send a signed-in reader here and count an open; analytics only.
export async function GET(request: Request): Promise<Response> {
  const query = new URL(request.url).searchParams;
  const parsed = Open.safeParse(Object.fromEntries(query));
  if (!parsed.success) return home();
  const { item, moment, chip, pos, from, target } = parsed.data;
  // A feed card has a position; a Continue link has none.
  if ((from === undefined) === (pos === undefined)) return home();
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
    jar.set(
      READING_COOKIE,
      formatReading({
        itemId: item,
        // The moment only when the reader really reached it, not a fallback.
        momentId: link.linkType === "article" ? null : (moment ?? null),
      }),
      session,
    );
    if (pos === undefined) {
      events().emit("continue_clicked", {}, context);
    } else {
      events().emit(
        "card_opened",
        {
          kind: moment === undefined ? "article" : "moment",
          chip,
          position: pos,
        },
        context,
      );
    }
    events().emit(
      "outbound_click",
      { link_type: link.linkType, target },
      context,
    );
  }
  return new Response(null, { status: 302, headers: { location: publisher } });
}
