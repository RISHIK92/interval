import type { FeedResponse, FeedSetup } from "@interval/api-client";
import { forbidden } from "../../../server/capability";
import {
  events,
  feedReader,
  preferences,
  progress,
  sessionReader,
  usernames,
} from "../../../server/container";
import { loadFeed } from "../../../server/feed";
import { appPlatform, fromSiteOrApp } from "../../../server/same-origin";
import { applyMatchEvidence } from "../../play/live/evidence";

export const dynamic = "force-dynamic";

// As Home reads it (app/page.tsx).
const FEED_LIMIT = 50;

// P4-W20-S01 (§5A, CACHE-1): Home's feed for the app, read as Home reads it: the stored
// feed (a first visit waits or gets the starter, ADR-0008), less what Continue reading
// offers. ADR-0058: one list; a ?chip= the CLI or an old app still sends is ignored.
const setup = (due: FeedSetup["setup"]) =>
  Response.json({ setup: due } satisfies FeedSetup, { status: 409 });

export async function GET(request: Request): Promise<Response> {
  if (!fromSiteOrApp(request)) return new Response(null, { status: 403 });
  const actor = await sessionReader().current(request.headers);
  // ADR-0029: guests play, and only play.
  if (actor === null || actor.isGuest)
    return new Response(null, { status: 401 });
  // ADR-0036: the feed's capability, as Home checks it.
  const refused = await forbidden(actor, "feed.read");
  if (refused !== null) return refused;
  // Onboarding and the username are on the web for now; the app says which is due.
  const chosen = await preferences().get(actor.userId);
  if (chosen === null) return setup("onboarding");
  if ((await usernames().get(actor.userId)) === null) return setup("username");
  // As Home: finished live matches count before the feed is read (P3-W15-S05).
  await applyMatchEvidence(actor);
  const [{ cards: loaded }, continuing] = await Promise.all([
    loadFeed({ feed: feedReader() }, actor.userId, chosen, FEED_LIMIT),
    progress().continueCards(actor.userId, new Date(), 3),
  ]);
  const fresh = loaded.filter(
    (card) => !continuing.some((c) => c.itemId === card.itemId),
  );
  // As Home: never "nothing" while there are cards.
  const cards = fresh.length > 0 ? fresh : loaded;
  const source = appPlatform(request);
  events().emit(
    "feed_viewed",
    { card_count: cards.length },
    { ...actor, sessionId: null, ...(source === undefined ? {} : { source }) },
  );
  // Typed by the shared schema: a change to the cards' shape breaks the build here.
  const body: FeedResponse = { cards };
  return Response.json(body, { headers: { "Cache-Control": "no-store" } });
}
