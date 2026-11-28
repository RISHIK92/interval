import { cookies, headers } from "next/headers";
import Link from "next/link";
import { Fragment } from "react";
import { redirect } from "next/navigation";
import {
  agentHook,
  books,
  entitlements,
  events,
  feedback,
  feedReader,
  notes,
  paths,
  progress,
  preferences,
  quizzes,
  sessionReader,
} from "../server/container";
import { loadFeed } from "../server/feed";
import { parseReading, READING_COOKIE } from "../server/reading";
import { BIGINT_ID, type FeedCard } from "../server/ports";
import { visitId } from "../server/visits";
import { signOutAction } from "./actions";
import { AgentBanner } from "./AgentBanner";
import { applyMatchEvidence } from "./play/live/evidence";
import { requireUsername } from "./username/gate";
import { ArticleCard } from "./ArticleCard";
import { CardControls } from "./CardControls";
import { ComingLater } from "./ComingLater";
import { ContinueReading } from "./ContinueReading";
import { FeedRow } from "./FeedRow";
import { Greeting } from "./Greeting";
import { NowReading } from "./NowReading";
import { ReturnPrompt } from "./ReturnPrompt";
import { UndoNotInterested } from "./UndoNotInterested";
import { StartQuiz, ZAP } from "./quiz/StartQuiz";
import { BookCard } from "./BookCard";
import { DailyCard } from "./DailyCard";
import { PathCard } from "./PathCard";
import { ReviewCard } from "./ReviewCard";
import { Card } from "./ui/Card";
import { Page } from "./ui/Page";

export const dynamic = "force-dynamic";

const FEED_LIMIT = 50;

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Account first (ADR-0016): no session, no app; /join is open to anyone (ADR-0056).
  const actor = await sessionReader().current(await headers());
  if (actor === null) redirect("/join");
  // ADR-0029: guests play, and only play; the rest is for accounts.
  if (actor.isGuest) redirect("/sign-up");
  // Guest-first onboarding (§5A, P1-W4-S01): goals, topics and level first.
  const chosen = await preferences().get(actor.userId);
  if (chosen === null) redirect("/onboarding");
  await requireUsername(actor.userId, "/");
  // P3-W15-S05: finished live matches count toward mastery and review.
  await applyMatchEvidence(actor);
  const account = (
    <form action={signOutAction} className="text-sm text-ink-muted">
      <button type="submit" className="underline underline-offset-2">
        Sign out
      </button>
    </form>
  );
  // ADR-0019: a greeting line picked on the device; the profile moves to the sidebar on
  // wide screens.
  // ADR-0058: no break-length question above it any more.
  const header = (continuing: string | null) => (
    <header className="flex items-start justify-between gap-4">
      <div>
        <Greeting firstName={chosen.firstName} continuing={continuing} />
        {account}
      </div>
      <Link
        href="/profile"
        aria-label="Profile"
        className="flex size-11 shrink-0 items-center justify-center rounded-full bg-well text-ink lg:hidden"
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
        {header(null)}
        <Card className="mt-6 p-8 text-center text-ink-muted">
          <p>Your plan doesn&apos;t include the feed.</p>
        </Card>
      </main>
    );
  }
  // ADR-0058: one feed, no time chips; an old link's ?chip= is ignored.
  const jar = await cookies();
  const params = await searchParams;
  // Offered only for an item this user really marked Not interested (P1-W4-S07).
  const undo = params["undo"];
  const undoable =
    typeof undo === "string" &&
    BIGINT_ID.test(undo) &&
    (await feedback().notInterested(actor.userId, undo))
      ? undo
      : null;
  // The article opened last (C-22), checked against what exists: the cookie is an id.
  const reading = parseReading(jar.get(READING_COOKIE)?.value);
  const [readingTitles, readingNote] =
    reading === null
      ? [null, null]
      : await Promise.all([
          progress().describe(reading),
          notes().get(actor.userId, reading),
        ]);
  // After Yes or Mark done: the article is Completed, and its quiz is offered again
  // (ADR-0058). Only for an article that exists: a forged param says nothing.
  const finishedId = parseReading(
    typeof params["finished"] === "string" ? params["finished"] : undefined,
  );
  const completed =
    finishedId === null ? null : await progress().describe(finishedId);
  const finished =
    finishedId === null || completed === null
      ? null
      : { itemId: finishedId, articleTitle: completed.articleTitle };
  // Back from the in-app reader (ADR-0018): ask about what it showed. An id, in the
  // reading cookie's form; a finish of an id that names nothing writes nothing.
  const askId = parseReading(
    typeof params["ask"] === "string" ? params["ask"] : undefined,
  );
  const ask = askId === null ? null : { itemId: askId };
  // Read live: a finish shows its continue card at once (owner, 2026-10-26).
  const continuing = await progress().continueCards(
    actor.userId,
    new Date(),
    3,
  );
  // The stored feed (CACHE-1); a first visit may wait for it, then a starter (ADR-0008).
  const { cards: loaded } = await loadFeed(
    { feed: feedReader() },
    actor.userId,
    chosen,
    FEED_LIMIT,
  );
  // An article already in Continue reading isn't offered again below it (owner,
  // 2026-10-27).
  const fresh = loaded.filter(
    (card) => !continuing.some((c) => c.itemId === card.itemId),
  );
  // Never "Nothing to read yet" while there are cards: then they show after all.
  const cards = fresh.length > 0 ? fresh : loaded;
  events().emit(
    "feed_viewed",
    { card_count: cards.length },
    { ...actor, sessionId: visitId(jar) },
  );
  // P2-W7-S04: each card's own note on its article.
  const onCards = await notes().onItems(
    actor.userId,
    cards.map((c) => c.itemId),
  );
  const yours = new Map(onCards.map((n) => [n.itemId, n.body]));
  // P2-W9-S06: due reviews are read when the feed is served; they change by the
  // minute.
  // P2-W10-S06: so is the active path's next step (the first card), and (S05) the
  // next session of the book read last.
  // P3-W13-S05 (§6.1): today's challenge while it's still to play, on plans with it.
  // P3-W17-S04 (§7, Q-P3-28): a running agent's elapsed time; the place its finish saved.
  const now = new Date();
  const [
    due,
    testable,
    pathNext,
    bookNext,
    daily,
    playsDaily,
    agentRun,
    place,
  ] = await Promise.all([
    quizzes().dueReviews(actor.userId),
    // P2-W9-S02: which cards, and the article just completed, can start Quiz me.
    quizzes().offered([
      ...cards.map((card) => card.itemId),
      ...(finished === null ? [] : [finished.itemId]),
    ]),
    paths().next(actor.userId),
    books().nextSession(actor.userId),
    quizzes().dailyStatus(actor.userId),
    entitlements().can(actor.userId, "play.daily"),
    agentHook().running(actor.userId, now),
    agentHook().place(actor.userId, now),
  ]);
  const dailyCard =
    playsDaily && daily.today === "open" ? (
      <DailyCard streak={daily.streak} />
    ) : null;
  // ADR-0058: Also fits sized its cards to the break; with no break length it is gone,
  // and the challenge and the review stay in the row on every screen.
  const renderCard = (card: FeedCard, index: number) => (
    <ArticleCard
      card={card}
      position={index + 1}
      controls={
        <CardControls
          itemId={card.itemId}
          title={card.articleTitle}
          saved={card.saved}
          reasons={card.reasons?.kinds ?? []}
          testable={testable.has(card.itemId)}
        />
      }
      yourNote={yours.get(card.itemId) ?? null}
    />
  );
  return (
    <Page
      tab="home"
      firstName={chosen.firstName}
      rail={
        <ComingLater
          streak={playsDaily ? daily.streak : null}
          path={pathNext}
          due={due.length}
        />
      }
    >
      <div className="lg:mb-5 lg:flex lg:flex-wrap lg:items-end lg:justify-between lg:gap-x-6">
        {header(continuing[0]?.articleTitle ?? null)}
        {/* On the web, under the greeting rather than beside it. */}
        <div className="lg:order-last lg:mt-4 lg:w-full lg:empty:hidden">
          <AgentBanner
            startedAt={agentRun?.startedAt.getTime() ?? null}
            place={place}
            now={now.getTime()}
          />
        </div>
      </div>
      {/* The panel steps aside while the prompt asks (owner, 2026-10-26). */}
      <ReturnPrompt initialAsk={ask}>
        {reading === null || readingTitles === null ? null : (
          <NowReading
            itemId={reading}
            articleTitle={readingTitles.articleTitle}
            note={readingNote}
          />
        )}
      </ReturnPrompt>
      {finished === null ? null : (
        <div
          role="status"
          className="my-4 flex flex-wrap items-center gap-3 rounded-2xl bg-well px-4 py-3"
        >
          <p>
            Completed: <strong>{finished.articleTitle}</strong>
          </p>
          {/* ADR-0058: the article's quiz is offered again once it is Completed. */}
          {testable.has(finished.itemId) ? (
            <StartQuiz
              itemId={finished.itemId}
              back="/"
              className="inline-flex items-center gap-2 rounded-full bg-ink px-5 py-2.5 font-semibold text-page"
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                className="size-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinejoin="round"
              >
                <path d={ZAP} />
              </svg>
              Quiz me
            </StartQuiz>
          ) : null}
        </div>
      )}
      <ContinueReading cards={continuing} />
      {undoable === null ? null : <UndoNotInterested itemId={undoable} />}
      {cards.length === 0 ? (
        <>
          <Card className="mt-6 p-8 text-center text-ink-muted">
            <p>Nothing to read yet.</p>
          </Card>
          {pathNext === null ? null : (
            <div className="mt-4">
              <PathCard next={pathNext} />
            </div>
          )}
          {bookNext === null ? null : (
            <div className="mt-4">
              <BookCard next={bookNext} />
            </div>
          )}
          {dailyCard === null ? null : <div className="mt-4">{dailyCard}</div>}
          {/* With no cards to sit behind, the review shows alone (owner,
            2026-10-28, Q-P2-21). */}
          {due.length > 0 ? (
            <div className="mt-4">
              <ReviewCard due={due} />
            </div>
          ) : null}
        </>
      ) : (
        // ADR-0019: one full-size card at a time, sideways; only a sliver of the next
        // card's edge says there is more. Arrow keys scroll it once it has focus. The
        // vertical padding, taken back by the negative margin, keeps card shadows from
        // being clipped by the scroller.
        <FeedRow>
          <ul className="flex gap-2">
            {/* P2-W10-S06 (Q-P2-27): the path's next step comes first; the
              ranked cards keep their positions. */}
            {pathNext === null ? null : (
              <li className="w-[calc(100%-18px)] shrink-0 snap-start snap-always last:w-full">
                <PathCard next={pathNext} />
              </li>
            )}
            {bookNext === null ? null : (
              <li className="w-[calc(100%-18px)] shrink-0 snap-start snap-always last:w-full">
                <BookCard next={bookNext} />
              </li>
            )}
            {/* P3-W13-S05: after the path and book; the ranked cards keep their
              positions. */}
            {dailyCard === null ? null : (
              <li className="w-[calc(100%-18px)] shrink-0 snap-start snap-always last:w-full">
                {dailyCard}
              </li>
            )}
            {cards.map((card, index) => (
              <Fragment key={card.itemId}>
                <li className="w-[calc(100%-18px)] shrink-0 snap-start snap-always last:w-full">
                  {renderCard(card, index)}
                </li>
                {/* P2-W9-S06 (Q-P2-17): the review takes the second slot; the
                  cards keep their ranked positions. */}
                {index === 0 && due.length > 0 ? (
                  <li className="w-[calc(100%-18px)] shrink-0 snap-start snap-always last:w-full">
                    <ReviewCard due={due} />
                  </li>
                ) : null}
              </Fragment>
            ))}
          </ul>
        </FeedRow>
      )}
    </Page>
  );
}
