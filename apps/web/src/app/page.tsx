import { cookies, headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  entitlements,
  events,
  feedback,
  feedReader,
  progress,
  preferences,
  sessionReader,
} from "../server/container";
import { CHIP_COOKIE, chipFor, chipLabel, CHIPS } from "../server/chips";
import { loadFeed } from "../server/feed";
import { outHref } from "../server/outbound";
import { parseReading, READING_COOKIE } from "../server/reading";
import { BIGINT_ID } from "../server/ports";
import { visitId } from "../server/visits";
import { signOutAction } from "./actions";
import { ArticleCard } from "./ArticleCard";
import { CardControls, UndoNotInterested } from "./CardControls";
import { ContinueReading } from "./ContinueReading";
import { NowReading } from "./NowReading";
import { ReturnPrompt } from "./ReturnPrompt";
import { TabNav } from "./TabNav";
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
        <p>
          <Link href="/profile">Profile</Link>
        </p>
        {account}
        <p>Your plan doesn&apos;t include the feed.</p>
      </main>
    );
  }
  // The selected time chip picks the feed (Q-P1-16); the proxy remembers a chip link.
  const jar = await cookies();
  const params = await searchParams;
  const chip = chipFor(params["chip"], jar.get(CHIP_COOKIE)?.value, chosen);
  // Offered only for an item this user really marked Not interested (P1-W4-S07).
  const undo = params["undo"];
  const undoable =
    typeof undo === "string" &&
    BIGINT_ID.test(undo) &&
    (await feedback().notInterested(actor.userId, undo))
      ? undo
      : null;
  // The card opened last (C-22), checked against what exists: the cookie is only ids.
  const reading = parseReading(jar.get(READING_COOKIE)?.value);
  const readingTitles =
    reading === null
      ? null
      : await progress().describe(reading.itemId, reading.momentId);
  // After Yes or Mark done on a section: the next section, or the end (owner).
  const finished = parseReading(
    typeof params["finished"] === "string" ? params["finished"] : undefined,
  );
  // Only for a section that exists and may be shown: a forged param says nothing.
  const next =
    finished === null || finished.momentId === null
      ? undefined
      : (await progress().describe(finished.itemId, finished.momentId)) === null
        ? undefined
        : await progress().nextMoment(finished.itemId, finished.momentId);
  // Read live: a finish shows its continue card at once (owner, 2026-10-26).
  const continuing = await progress().continueCards(
    actor.userId,
    new Date(),
    3,
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
      <p>
        <Link href="/profile">Profile</Link>
      </p>
      {account}
      <TabNav current="home" />
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
      {/* The panel steps aside while the prompt asks (owner, 2026-10-26). */}
      <ReturnPrompt chip={chip}>
        {reading === null || readingTitles === null ? null : (
          <NowReading reading={reading} titles={readingTitles} chip={chip} />
        )}
      </ReturnPrompt>
      {finished === null || next === undefined ? null : next === null ? (
        <p role="status">That was the last section.</p>
      ) : (
        <p role="status">
          Continue:{" "}
          <a
            href={outHref({
              itemId: finished.itemId,
              momentId: next.momentId,
              from: "continue",
              target: "section",
            })}
            data-item={finished.itemId}
            data-moment={next.momentId}
            target="_blank"
            rel="noopener noreferrer"
          >
            {next.title}
          </a>
        </p>
      )}
      <ContinueReading cards={continuing} chip={chip} />
      {undoable === null ? null : (
        <UndoNotInterested itemId={undoable} chip={chip} />
      )}
      {cards.length === 0 ? (
        <p>No moments yet.</p>
      ) : (
        cards.map((card, index) => (
          <section
            key={
              card.kind === "moment" ? `m${card.momentId}` : `a${card.itemId}`
            }
          >
            {card.kind === "moment" ? (
              <MomentCard card={card} chip={chip} position={index + 1} />
            ) : (
              <ArticleCard card={card} chip={chip} position={index + 1} />
            )}
            <CardControls
              itemId={card.itemId}
              title={
                card.kind === "moment" ? card.sectionTitle : card.articleTitle
              }
              saved={card.saved}
              chip={chip}
            />
          </section>
        ))
      )}
    </main>
  );
}
