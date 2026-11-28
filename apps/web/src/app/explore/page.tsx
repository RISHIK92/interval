import { cookies, headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  asks,
  entitlements,
  events,
  explore,
  feedReader,
  preferences,
  sessionReader,
} from "../../server/container";
import { learnersLabel, SPACE_NAMES } from "../../server/explore";
import { outHref } from "../../server/outbound";
import {
  type ExploreGap,
  type ExploreResult,
  SAVED_MOST_TABS,
  type SavedMostItem,
  type SavedMostTab,
  type SpaceStats,
} from "../../server/ports";
import { offeredTopics } from "../../server/preferences";
import { visitId } from "../../server/visits";
import { TOPIC_NAMES } from "../ChoicesFields";
import { Page, PAGE_TITLE, RailCard } from "../ui/Page";
import { TopicArt } from "../ui/TopicArt";
import { dismissGapAction, followSpaceAction } from "./actions";
import { AskBox, type AskView } from "./AskBox";

export const dynamic = "force-dynamic";

// ADR-0046 (Explore, web, 2026-11-23): one box to ask or search, the gap worth closing,
// the user's spaces and, in the rail, what was saved most this week. Phones get one
// column, with the rail's cards inline.

const RESULTS = 20;
const MAX_QUERY = 300;

const TAB_LABELS: Record<SavedMostTab, [string, string]> = {
  // Q-WD-03 (pending the owner): "Engineers" waits for a role nobody has yet
  // (Q-WD-26), so the first tab is everyone's.
  everyone: ["Everyone", "Saved by 5 or more people in the last 7 days"],
  spaces: ["Spaces", "From the spaces you follow"],
  new: ["New", "Added in the last 7 days"],
};

const first = (value: string | string[] | undefined) =>
  (Array.isArray(value) ? value[0] : value) ?? "";

function Play() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-[13px]">
      <path d="M7 4.5v15l12-7.5z" fill="currentColor" />
    </svg>
  );
}

function Results({
  query,
  results,
}: {
  query: string;
  results: ExploreResult[];
}) {
  return (
    <section aria-label="Search results" className="flex flex-col gap-2.5">
      <h2 className="text-[17px] font-semibold tracking-[-0.01em]">
        {results.length === 0
          ? `Nothing in your library matches “${query}”`
          : `Results for “${query}”`}
      </h2>
      {results.length === 0 ? null : (
        <ul className="flex flex-col">
          {results.map((r) => (
            <li
              key={r.itemId}
              className="border-t border-hairline first:border-t-0"
            >
              <a
                href={outHref({
                  itemId: r.itemId,
                  from: "explore",
                  target: "article",
                })}
                target="_blank"
                rel="noopener noreferrer"
                className="flex min-h-14 flex-col justify-center gap-0.5 py-2.5"
              >
                <span className="text-[15px] leading-[1.3] font-semibold">
                  {r.articleTitle}
                </span>
                <span className="text-xs text-ink-muted">
                  {[
                    r.author === null
                      ? r.sourceName
                      : `${r.sourceName} · ${r.author}`,
                    r.minutes === null ? null : `${String(r.minutes)} min`,
                    r.saved ? "Saved" : null,
                  ]
                    .filter((part) => part !== null)
                    .join(" · ")}
                </span>
                {r.note === null ? null : (
                  <span className="line-clamp-2 text-[13px] text-ink-soft">
                    Your note: {r.note}
                  </span>
                )}
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function GapCard({ gap }: { gap: ExploreGap }) {
  return (
    <article className="flex flex-wrap overflow-hidden rounded-3xl border border-hairline bg-card shadow-card">
      {gap.topic === null ? null : (
        <TopicArt
          topic={gap.topic}
          className="min-h-[150px] w-full flex-[1_1_300px] lg:min-h-[170px]"
        />
      )}
      <div className="flex min-w-0 flex-[1_1_300px] flex-col justify-center gap-2.5 px-[22px] py-5">
        <span className="text-[13px] font-semibold text-ink-muted">
          A gap worth closing
        </span>
        <p className="text-[17px] leading-[1.45] text-ink-soft">
          You know <strong className="text-ink">{gap.known[0]}</strong> and{" "}
          <strong className="text-ink">{gap.known[1]}</strong>. The idea that
          connects them is <strong className="text-ink">{gap.concept}</strong>.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <a
            href={`/explore/gap?concept=${gap.conceptId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex h-12 items-center gap-2 rounded-full bg-ink px-[22px] text-[15px] font-semibold text-page"
          >
            <Play />
            Close the gap · {gap.minutes} min
          </a>
          <form action={dismissGapAction}>
            <input type="hidden" name="concept" value={gap.conceptId} />
            <button
              type="submit"
              className="h-12 rounded-full px-4 text-sm font-semibold text-ink-soft hover:bg-well"
            >
              Dismiss
            </button>
          </form>
        </div>
      </div>
    </article>
  );
}

function FollowButton({
  space,
  following,
  back,
  only,
}: {
  space: SpaceStats;
  following: boolean;
  back: "all" | "page";
  only: boolean; // the user's last topic: a feed needs one
}) {
  if (following && only)
    return (
      <span className="text-xs text-ink-muted">
        Your only space: follow another first
      </span>
    );
  return (
    <form action={followSpaceAction}>
      <input type="hidden" name="topic" value={space.topic} />
      <input type="hidden" name="follow" value={String(!following)} />
      <input type="hidden" name="back" value={back} />
      <button
        type="submit"
        className={`h-9 rounded-full px-3.5 text-sm font-semibold ${following ? "border-[1.5px] border-hairline-strong" : "bg-ink text-page"}`}
      >
        {following ? "Unfollow" : "Follow"}
      </button>
    </form>
  );
}

function SpaceCard({
  space,
  children,
}: {
  space: SpaceStats;
  children?: React.ReactNode;
}) {
  const learners = learnersLabel(space.learners);
  return (
    <li
      className="flex flex-col gap-0.5 rounded-[18px] p-3.5"
      style={{ background: `var(--${space.topic}-tint)` }}
    >
      <span className="mt-1.5 text-[15px] font-semibold">
        {SPACE_NAMES[space.topic]}
      </span>
      <span className="text-xs text-ink-soft">
        {learners ?? TOPIC_NAMES[space.topic]}
      </span>
      {space.fresh > 0 ? (
        <span className="mt-2 self-start rounded-full bg-card px-2 py-0.5 text-xs font-semibold text-go-ink">
          {space.fresh} new
        </span>
      ) : null}
      {children === undefined ? null : <div className="mt-2">{children}</div>}
    </li>
  );
}

function Spaces({
  spaces,
  followed,
  all,
}: {
  spaces: SpaceStats[];
  followed: readonly string[];
  all: boolean;
}) {
  const shown = all ? spaces : spaces.filter((s) => followed.includes(s.topic));
  return (
    <section aria-label="Your spaces" className="flex flex-col gap-2.5">
      <div className="flex items-baseline justify-between">
        <h2 className="text-[17px] font-semibold tracking-[-0.01em]">
          {all ? "All spaces" : "Your spaces"}
        </h2>
        <Link
          href={all ? "/explore" : "/explore?spaces=all"}
          className="text-sm font-semibold text-ink-soft underline underline-offset-[3px]"
        >
          {all ? "Your spaces" : "Find more"}
        </Link>
      </div>
      <ul className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-2.5">
        {shown.map((space) => (
          <SpaceCard key={space.topic} space={space}>
            {all ? (
              <FollowButton
                space={space}
                following={followed.includes(space.topic)}
                back="all"
                only={followed.length === 1}
              />
            ) : undefined}
          </SpaceCard>
        ))}
      </ul>
    </section>
  );
}

function SavedMost({
  tab,
  items,
}: {
  tab: SavedMostTab;
  items: SavedMostItem[];
}) {
  const [, note] = TAB_LABELS[tab];
  const href = (t: SavedMostTab) => {
    // Without the query: a tab change isn't another search (explore_searched, DB-5).
    return t === "everyone" ? "/explore" : `/explore?tab=${t}`;
  };
  return (
    <section
      aria-label="Saved most this week"
      className="flex flex-col gap-2.5 rounded-[22px] border border-hairline bg-card p-[18px] shadow-card"
    >
      <h2 className="text-base font-semibold">Saved most this week</h2>
      <nav
        aria-label="Whose saves"
        className="grid h-[38px] grid-cols-3 gap-[3px] rounded-xl bg-well p-[3px]"
      >
        {SAVED_MOST_TABS.map((t) => (
          <Link
            key={t}
            href={href(t)}
            aria-current={t === tab ? "true" : undefined}
            className={`flex items-center justify-center rounded-[9px] text-[13px] whitespace-nowrap ${t === tab ? "bg-lift font-semibold text-ink shadow-card" : "font-medium text-ink-soft"}`}
          >
            {TAB_LABELS[t][0]}
          </Link>
        ))}
      </nav>
      <span className="text-[13px] text-ink-muted">{note}</span>
      {items.length === 0 ? (
        <p className="text-sm text-ink-muted">
          Nothing here has been saved by 5 people this week yet.
        </p>
      ) : (
        <ol className="flex flex-col">
          {items.map((item, i) => (
            <li key={item.itemId} className="border-t border-hairline">
              <a
                href={outHref({
                  itemId: item.itemId,
                  from: "explore",
                  target: "article",
                })}
                target="_blank"
                rel="noopener noreferrer"
                className="flex min-h-14 items-center gap-3"
              >
                <span className="w-[18px] text-base font-bold text-ink-muted">
                  {i + 1}
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-px">
                  <span className="text-sm leading-[1.3] font-semibold">
                    {item.title}
                  </span>
                  <span className="text-xs text-ink-muted">
                    {item.minutes === null
                      ? item.sourceName
                      : `${item.sourceName} · ${String(item.minutes)} min`}
                  </span>
                </span>
              </a>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function OwnReading() {
  return (
    <RailCard surface="bg-well" className="flex flex-col gap-2">
      <span className="text-[15px] font-semibold">Bring your own reading</span>
      <span className="text-[13px] leading-[1.45] text-ink-soft">
        Upload a PDF to read it in short sessions.
      </span>
      <Link
        href="/books/new"
        className="flex h-[38px] items-center gap-1.5 self-start rounded-full border-[1.5px] border-hairline-strong pr-3.5 pl-3 text-sm font-semibold"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="size-[15px]"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        >
          <path d="M12 5v14M5 12h14" />
        </svg>
        Add a book
      </Link>
    </RailCard>
  );
}

export default async function ExplorePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await sessionReader().current(await headers());
  if (actor === null) redirect("/join");
  // ADR-0029: guests play, and only play.
  if (actor.isGuest) redirect("/sign-up");
  const chosen = await preferences().get(actor.userId);
  if (chosen === null) redirect("/onboarding");
  const params = await searchParams;
  const query = first(params["q"]).trim().slice(0, MAX_QUERY);
  const tab =
    SAVED_MOST_TABS.find((t) => t === first(params["tab"])) ?? "everyone";
  const allSpaces = first(params["spaces"]) === "all";
  const now = new Date();
  const [canAsk, results, gap, stats, offered, saved] = await Promise.all([
    entitlements().can(actor.userId, "explore.ask"),
    query === "" ? null : explore().search(actor.userId, query, RESULTS),
    explore().gap(actor.userId),
    explore().spaces(actor.userId, now),
    offeredTopics(feedReader()),
    explore().savedMost(actor.userId, tab, chosen.topics, now),
  ]);
  const latest = canAsk ? await asks().latest(actor.userId) : null;
  if (results !== null)
    events().emit(
      "explore_searched",
      { result_count: results.length },
      { ...actor, sessionId: visitId(await cookies()) },
    );
  // ADR-0049: a space only for a topic offered now, or one the user already follows.
  const spaces = stats.filter(
    (s) => offered.includes(s.topic) || chosen.topics.includes(s.topic),
  );
  const initial: AskView | null =
    latest === null
      ? null
      : {
          id: latest.id,
          text: latest.text,
          chip: latest.chip,
          depth: latest.depth,
          answer: latest.answer,
        };
  const savedMost = <SavedMost tab={tab} items={saved} />;
  return (
    <Page
      tab="explore"
      firstName={chosen.firstName}
      railLabel="Saved and your own reading"
      rail={
        <>
          {savedMost}
          <OwnReading />
        </>
      }
      className="flex flex-col gap-[18px]"
    >
      <h1 className={PAGE_TITLE}>Explore</h1>
      <AskBox canAsk={canAsk} query={query} initial={initial} />
      {results === null ? null : <Results query={query} results={results} />}
      {gap === null ? null : <GapCard gap={gap} />}
      <Spaces spaces={spaces} followed={chosen.topics} all={allSpaces} />
      {/* Phones: one column, the rail's cards inline (ADR-0046). */}
      <div className="flex flex-col gap-3 lg:hidden">
        {savedMost}
        <OwnReading />
      </div>
    </Page>
  );
}
