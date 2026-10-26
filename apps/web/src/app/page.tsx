import { cookies, headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  entitlements,
  events,
  feedReader,
  preferences,
  sessionReader,
} from "../server/container";
import { CHIP_COOKIE, chipFor, chipLabel, CHIPS } from "../server/chips";
import { loadFeed } from "../server/feed";
import { visitId } from "../server/visits";
import { signOutAction } from "./actions";
import { ArticleCard } from "./ArticleCard";
import { MomentCard } from "./MomentCard";

export const dynamic = "force-dynamic";

const FEED_LIMIT = 50;

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Private beta (Q-P1-24): no session, no app.
  const actor = await sessionReader().current(await headers());
  if (actor === null) redirect("/join");
  // Guest-first onboarding (§5A, P1-W4-S01): topics, level and break length first.
  const chosen = await preferences().get(actor.userId);
  if (chosen === null) redirect("/onboarding");
  const account = actor.isGuest ? (
    <p>
      <Link href="/sign-up">Sign up to keep your progress</Link>
    </p>
  ) : (
    <form action={signOutAction}>
      <button type="submit">Sign out</button>
    </form>
  );
  // OPS-3: the feed is a capability of the user's plan.
  if (!(await entitlements().can(actor.userId, "feed.read"))) {
    return (
      <main>
        <h1>Interval</h1>
        {account}
        <p>Your plan doesn&apos;t include the feed.</p>
      </main>
    );
  }
  // The selected time chip picks the feed (Q-P1-16); the proxy remembers a chip link.
  const jar = await cookies();
  const chip = chipFor(
    (await searchParams)["chip"],
    jar.get(CHIP_COOKIE)?.value,
    chosen,
  );
  // The stored feed (CACHE-1); a first visit may wait for it, then a starter (ADR-0008).
  const { cards } = await loadFeed(
    { feed: feedReader() },
    actor.userId,
    chosen,
    chip,
    FEED_LIMIT,
  );
  events().emit(
    "feed_viewed",
    { card_count: cards.length },
    { ...actor, sessionId: visitId(jar) },
  );
  return (
    <main>
      <h1>Interval</h1>
      {account}
      <nav aria-label="Break length">
        <ul>
          {CHIPS.map((option) => (
            <li key={option}>
              <Link
                href={`/?chip=${option}`}
                aria-current={option === chip ? "true" : undefined}
              >
                {option === chip ? (
                  <strong>{chipLabel(option)}</strong>
                ) : (
                  chipLabel(option)
                )}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {cards.length === 0 ? (
        <p>No moments yet.</p>
      ) : (
        cards.map((card) =>
          card.kind === "moment" ? (
            <MomentCard key={`m${card.momentId}`} card={card} chip={chip} />
          ) : (
            <ArticleCard key={`a${card.itemId}`} card={card} chip={chip} />
          ),
        )
      )}
    </main>
  );
}
