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
import { BIGINT_ID, type FeedCard } from "../server/ports";
import { visitId } from "../server/visits";
import { signOutAction } from "./actions";
import { ArticleCard } from "./ArticleCard";
import { CardControls, UndoNotInterested } from "./CardControls";
import { ContinueReading } from "./ContinueReading";
import { NowReading } from "./NowReading";
import { ReturnPrompt } from "./ReturnPrompt";
import { TabBar } from "./TabBar";
import { MomentCard } from "./MomentCard";
import { Card } from "./ui/Card";

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
    <p className="text-sm text-ink-muted">
      <Link href="/sign-up" className="underline underline-offset-2">
        Sign up to keep your progress
      </Link>
    </p>
  ) : (
    <form action={signOutAction} className="text-sm text-ink-muted">
      <button type="submit" className="underline underline-offset-2">
        Sign out
      </button>
    </form>
  );
  // No name or initials to show yet, so the avatar is a person glyph.
  const header = (
    <header className="flex items-start justify-between gap-4">
      <div>
        <h1 className="text-display">Your next few minutes</h1>
        {account}
      </div>
      <Link
        href="/profile"
        aria-label="Profile"
        className="flex size-11 shrink-0 items-center justify-center rounded-full bg-well text-ink"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="size-6"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        >
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21a8 8 0 0 1 16 0" />
        </svg>
      </Link>
    </header>
  );
  // OPS-3: the feed is a capability of the user's plan.
  if (!(await entitlements().can(actor.userId, "feed.read"))) {
    return (
      <main className="mx-auto max-w-xl px-4 pt-6 pb-[calc(6rem+env(safe-area-inset-bottom))]">
        {header}
        <Card className="mt-6 p-8 text-center text-ink-muted">
          <p>Your plan doesn&apos;t include the feed.</p>
        </Card>
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
  // Back from the in-app reader (ADR-0018): ask about what it showed. Ids only, in the
  // reading cookie's form; a finish of ids that name nothing writes nothing.
  const ask = parseReading(
    typeof params["ask"] === "string" ? params["ask"] : undefined,
  );
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
  const [first, ...rest] = cards;
  // The first card is the hero; the rest are compact rows (design screen 2).
  const renderCard = (card: FeedCard, index: number) => {
    const hero = index === 0;
    const controls = (
      <CardControls
        itemId={card.itemId}
        title={card.kind === "moment" ? card.sectionTitle : card.articleTitle}
        saved={card.saved}
        chip={chip}
        compact={!hero}
      />
    );
    return card.kind === "moment" ? (
      <MomentCard
        card={card}
        chip={chip}
        position={index + 1}
        hero={hero}
        controls={controls}
      />
    ) : (
      <ArticleCard
        card={card}
        chip={chip}
        position={index + 1}
        hero={hero}
        controls={controls}
      />
    );
  };
  return (
    <main className="mx-auto max-w-xl px-4 pt-6 pb-[calc(6rem+env(safe-area-inset-bottom))]">
      {header}
      <TabBar current="home" />
      <nav aria-label="Break length" className="my-4">
        {/* The design's segmented chips: a well, the chosen one lifted. */}
        <ul className="flex gap-1 rounded-2xl bg-well p-1">
          {CHIPS.map((option) => (
            <li key={option} className="flex-1">
              <Link
                href={`/?chip=${option}`}
                aria-current={option === chip ? "true" : undefined}
                className={`block rounded-xl py-2 text-center ${option === chip ? "bg-lift shadow-card" : "text-ink-muted"}`}
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
      <ReturnPrompt chip={chip} initialAsk={ask}>
        {reading === null || readingTitles === null ? null : (
          <NowReading reading={reading} titles={readingTitles} chip={chip} />
        )}
      </ReturnPrompt>
      {finished === null || next === undefined ? null : next === null ? (
        <p role="status" className="my-4 rounded-2xl bg-well px-4 py-3">
          That was the last section.
        </p>
      ) : (
        <p role="status" className="my-4 rounded-2xl bg-well px-4 py-3">
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
            className="font-semibold text-select"
          >
            {next.title}
          </a>
        </p>
      )}
      <ContinueReading cards={continuing} chip={chip} />
      {undoable === null ? null : (
        <UndoNotInterested itemId={undoable} chip={chip} />
      )}
      {first === undefined ? (
        <Card className="p-8 text-center text-ink-muted">
          <p>No moments yet.</p>
        </Card>
      ) : (
        <>
          {renderCard(first, 0)}
          {rest.length === 0 ? null : (
            <section aria-labelledby="also-fits" className="mt-6">
              <h2 id="also-fits" className="text-section">
                {`More for your ${chipLabel(chip)} break`}
              </h2>
              <ul className="divide-y divide-hairline">
                {rest.map((card, index) => (
                  <li
                    key={
                      card.kind === "moment"
                        ? `m${card.momentId}`
                        : `a${card.itemId}`
                    }
                  >
                    {renderCard(card, index + 1)}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </main>
  );
}
