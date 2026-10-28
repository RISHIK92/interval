import { cookies, headers } from "next/headers";
import Link from "next/link";
import { Fragment } from "react";
import { redirect } from "next/navigation";
import {
  entitlements,
  events,
  feedback,
  feedReader,
  notes,
  progress,
  preferences,
  quizzes,
  sessionReader,
} from "../server/container";
import {
  type Chip,
  CHIP_COOKIE,
  chipFor,
  chipLabel,
  CHIPS,
} from "../server/chips";
import { loadFeed } from "../server/feed";
import { outHref, readHref } from "../server/outbound";
import { parseReading, READING_COOKIE } from "../server/reading";
import { BIGINT_ID, type FeedCard, quizKey } from "../server/ports";
import { visitId } from "../server/visits";
import { signOutAction } from "./actions";
import { ArticleCard } from "./ArticleCard";
import { CardControls } from "./CardControls";
import { ComingLater } from "./ComingLater";
import { ContinueReading } from "./ContinueReading";
import { FeedRow } from "./FeedRow";
import { Greeting } from "./Greeting";
import { NowReading } from "./NowReading";
import { ReturnPrompt } from "./ReturnPrompt";
import { TabBar } from "./TabBar";
import { UndoNotInterested } from "./UndoNotInterested";
import { MomentCard } from "./MomentCard";
import { StartQuiz, ZAP } from "./quiz/StartQuiz";
import { ReviewCard } from "./ReviewCard";
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
  // ADR-0019: a greeting line picked on the device; the profile moves to the sidebar on
  // wide screens.
  const header = (chip: Chip, continuing: string | null) => (
    <header className="flex items-start justify-between gap-4">
      <div>
        <p className="text-sm text-ink-muted">How long is this break?</p>
        <Greeting
          firstName={chosen.firstName}
          chip={chip}
          continuing={continuing}
        />
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
        {header(chosen.breakLength, null)}
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
  const [readingTitles, readingNote] =
    reading === null
      ? [null, null]
      : await Promise.all([
          progress().describe(reading.itemId, reading.momentId),
          notes().get(actor.userId, reading.itemId, reading.momentId),
        ]);
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
  const { cards: loaded } = await loadFeed(
    { feed: feedReader() },
    actor.userId,
    chosen,
    chip,
    FEED_LIMIT,
  );
  // An article already in Continue reading isn't offered again below it (owner,
  // 2026-10-27).
  const fresh = loaded.filter(
    (card) => !continuing.some((c) => c.itemId === card.itemId),
  );
  // Never "No moments yet" while there are moments: then they show after all.
  const cards = fresh.length > 0 ? fresh : loaded;
  events().emit(
    "feed_viewed",
    { card_count: cards.length },
    { ...actor, sessionId: visitId(jar) },
  );
  // P2-W7-S04: each card's own note, on its section (or the article for an article
  // card).
  const onCards = await notes().onItems(
    actor.userId,
    cards.map((c) => c.itemId),
  );
  const yours = new Map(
    onCards.map((n) => [quizKey(n.itemId, n.momentId), n.body]),
  );
  // P2-W9-S02: which cards, and the section just finished, can start Test 60s.
  const target = (card: FeedCard) => ({
    itemId: card.itemId,
    momentId: card.kind === "moment" ? card.momentId : null,
  });
  // P2-W9-S06: due reviews are read when the feed is served; they change by the
  // minute.
  const [due, testable] = await Promise.all([
    quizzes().dueReviews(actor.userId),
    quizzes().offered([
      ...cards.map(target),
      ...(finished === null || next === undefined ? [] : [finished]),
    ]),
  ]);
  const yourNote = (card: FeedCard) =>
    yours.get(quizKey(target(card).itemId, target(card).momentId)) ?? null;
  const renderCard = (card: FeedCard, index: number) => {
    const on = target(card);
    const controls = (
      <CardControls
        itemId={card.itemId}
        title={card.kind === "moment" ? card.sectionTitle : card.articleTitle}
        saved={card.saved}
        chip={chip}
        test={
          testable.has(quizKey(on.itemId, on.momentId))
            ? { momentId: on.momentId }
            : null
        }
        originalHref={
          card.kind === "moment"
            ? outHref({
                itemId: card.itemId,
                momentId: card.momentId,
                chip,
                from: { position: index + 1 },
                target: "original",
              })
            : null
        }
      />
    );
    return card.kind === "moment" ? (
      <MomentCard
        card={card}
        chip={chip}
        position={index + 1}
        controls={controls}
        yourNote={yourNote(card)}
      />
    ) : (
      <ArticleCard
        card={card}
        chip={chip}
        position={index + 1}
        controls={controls}
        yourNote={yourNote(card)}
      />
    );
  };
  return (
    <div className="mx-auto max-w-xl px-4 pt-6 pb-[calc(6rem+env(safe-area-inset-bottom))] lg:grid lg:max-w-none lg:grid-cols-[minmax(0,1fr)_18rem] lg:gap-8 lg:pt-10 lg:pr-8 lg:pb-10 lg:pl-68">
      <main className="min-w-0 lg:w-full lg:max-w-[46rem] lg:justify-self-center lg:pl-16">
        <div className="lg:flex lg:items-end lg:justify-between lg:gap-6">
          {header(chip, continuing[0]?.sectionTitle ?? null)}
          <nav
            aria-label="Break length"
            className="my-4 lg:my-0 lg:w-72 lg:shrink-0"
          >
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
        </div>
        {/* The panel steps aside while the prompt asks (owner, 2026-10-26). */}
        <ReturnPrompt chip={chip} initialAsk={ask}>
          {reading === null || readingTitles === null ? null : (
            <NowReading
              reading={reading}
              titles={readingTitles}
              chip={chip}
              note={readingNote}
            />
          )}
        </ReturnPrompt>
        {finished === null || next === undefined ? null : next === null ? (
          <p role="status" className="my-4 rounded-2xl bg-well px-4 py-3">
            That was the last section.
          </p>
        ) : (
          <p role="status" className="my-4 rounded-2xl bg-well px-4 py-3">
            Continue:{" "}
            {/* In the reader when the page can be framed, as the cards do
              (ADR-0018). */}
            {next.frameable ? (
              <a
                href={readHref({
                  itemId: finished.itemId,
                  momentId: next.momentId,
                  chip,
                  from: "continue",
                })}
                data-read-item={finished.itemId}
                data-read-moment={next.momentId}
                className="font-semibold text-select"
              >
                {next.title}
              </a>
            ) : (
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
            )}
          </p>
        )}
        {/* The end of a section offers a test or the next one (wireframe 03, end). */}
        {finished !== null &&
        next !== undefined &&
        testable.has(quizKey(finished.itemId, finished.momentId)) ? (
          <StartQuiz
            itemId={finished.itemId}
            momentId={finished.momentId}
            chip={chip}
            back={`/?chip=${chip}`}
            className="mb-4 inline-flex items-center gap-2 rounded-full bg-ink px-5 py-2.5 font-semibold text-page"
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
            Test yourself · 60s
          </StartQuiz>
        ) : null}
        <ContinueReading cards={continuing} chip={chip} />
        {undoable === null ? null : (
          <UndoNotInterested itemId={undoable} chip={chip} />
        )}
        {cards.length === 0 ? (
          <>
            <Card className="mt-6 p-8 text-center text-ink-muted">
              <p>No moments yet.</p>
            </Card>
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
              {cards.map((card, index) => (
                <Fragment
                  key={
                    card.kind === "moment"
                      ? `m${card.momentId}`
                      : `a${card.itemId}`
                  }
                >
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
      </main>
      <ComingLater />
      <TabBar current="home" firstName={chosen.firstName} />
    </div>
  );
}
