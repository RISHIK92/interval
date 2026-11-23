import type { Capability } from "@interval/db";
import { headers } from "next/headers";
import Link from "next/link";
import type { ReactNode } from "react";
import { gameEnv, windowTimeZone } from "../../env";
import { windowsFrom } from "../../server/battle-windows";
import {
  battleWindows,
  entitlements,
  hldTournaments,
  hldWindows,
  playerRatings,
  preferences,
  quizzes,
  sessionReader,
} from "../../server/container";
import {
  type DailyStatus,
  type HldTournament,
  LIVE_QUESTIONS,
} from "../../server/ports";
import { DailyPlay } from "../DailyCard";
import {
  startDailyAction,
  startEstimationAction,
  startSprintAction,
} from "../quiz/actions";
import { streakText } from "../streakText";
import { TabBar } from "../TabBar";
import { requireUsername } from "../username/gate";
import { applyMatchEvidence } from "./live/evidence";
import { Card } from "../ui/Card";
import { GuestForm } from "./GuestForm";
import { NextWindow } from "./NextWindow";

export const dynamic = "force-dynamic";

// The design's line icons (24-unit grid), one per quick game.
const line = (path: ReactNode) => (
  <svg
    aria-hidden="true"
    viewBox="0 0 24 24"
    className="size-5"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {path}
  </svg>
);

// §6.3: the quick games, as the table words them. Estimation's full points are C-27's
// 1.25× (ADR-0006). Each game is its own capability (OPS-3), so a plan can leave one
// out; fastest finger is the live one (P3-W16-S05). In §6.3's order.
// `start`: playable now (P3-W13-S02: the sprint; S04: estimation; S05: the daily
// challenge, whose card also shows today's result and the streak); the rest arrive
// with their slices. `icon` and `tint`: the wide layout's tile (Play hub, web).
type Game = {
  name: string;
  format: string;
  win: string;
  capability: Capability;
  start?: { action: () => Promise<void>; label: string };
  icon: ReactNode;
  tint: string;
  minutes?: string;
};

const QUICK: Game[] = [
  {
    name: "Daily challenge",
    format: "Solo, the same set for everyone, one attempt",
    win: "Score and streak; the result shares as a card that doesn't reveal the questions",
    capability: "play.daily",
    start: { action: startDailyAction, label: "Start today's challenge" },
    icon: line(
      <>
        <rect x="4" y="5" width="16" height="16" rx="2" />
        <path d="M4 10h16M9 3v4M15 3v4" />
      </>,
    ),
    tint: "bg-(--review-tint) text-(--review-line)",
  },
  {
    name: "60-second sprint",
    format: "Solo or 1v1",
    win: "Most correct in 60 seconds",
    capability: "play.sprint",
    start: { action: startSprintAction, label: "Start a sprint" },
    icon: line(
      <>
        <circle cx="12" cy="13" r="8" />
        <path d="M12 9v4l2.5 2M10 2h4" />
      </>,
    ),
    tint: "bg-(--distributed-systems-tint) text-(--distributed-systems-line)",
  },
  {
    name: "Fastest finger",
    format: `1v1 live, ${String(LIVE_QUESTIONS.fastest_finger)} rounds`,
    win: "First correct answer takes each round",
    capability: "play.live",
    icon: line(<path d="M13 2 4 14h7l-1 8 9-12h-7z" />),
    tint: "bg-live/10 text-wrong",
  },
  {
    name: "Estimation",
    format: "Solo or 1v1",
    win: "Scored by how many times off the answer is; full points within 1.25× of the answer",
    capability: "play.estimation",
    start: { action: startEstimationAction, label: "Start a round" },
    icon: line(<path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />),
    tint: "bg-(--databases-tint) text-(--databases-line)",
  },
];

const BATTLES: Game[] = [
  // P5-W32 (§6.5, §6.6): ranked windows and the casual queue start at /play/battle.
  {
    name: "LLD battle",
    format:
      "Ranked windows in rooms of up to 4, or a casual 1v1, about 45 minutes",
    win: "Most points from passed tests; a tie goes to whoever got there first",
    capability: "play.battle",
    minutes: "45 min",
    icon: (
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="size-[30px]"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="m8 6-6 6 6 6M16 6l6 6-6 6" />
      </svg>
    ),
    tint: "bg-(--distributed-systems-tint) text-(--distributed-systems-right)",
  },
  // P6-W42 (§6.4, MATCH-7, Q-P6-06): HLD battles and practice (ADR-0042 PROPOSED).
  {
    name: "System design battle",
    format: "A 1v1 or solo, about 30 minutes; practice any time",
    win: "Simulation 60, the AI rubric 25, speed 15",
    capability: "play.hld",
    minutes: "30 min",
    icon: (
      <svg aria-hidden="true" viewBox="0 0 40 40" className="size-11">
        <path d="M20 6 32 12 20 18 8 12z" fill="var(--system-design-top)" />
        <path d="M8 12 20 18v14L8 26z" fill="var(--system-design-left)" />
        <path d="M20 18 32 12v14L20 32z" fill="var(--system-design-right)" />
      </svg>
    ),
    tint: "bg-(--system-design-tint)",
  },
];

const GAMES = [...QUICK, ...BATTLES];
const allowedFor = (allowed: boolean[] | null, capability: Capability) =>
  allowed === null
    ? null
    : allowed[GAMES.findIndex((g) => g.capability === capability)] === true;

// Phones: the pill as it was; wide screens: the design's 40 px, 12 px-radius button.
const ACT =
  "rounded-full bg-ink px-5 py-2.5 font-semibold text-page lg:rounded-xl lg:px-4 lg:py-2 lg:text-sm";
const QUIET =
  "rounded-full border border-hairline px-5 py-2.5 font-semibold lg:rounded-xl lg:border-[1.5px] lg:border-track lg:px-4 lg:py-2 lg:text-sm";
// The wide layout's side cards (Play hub, web).
const SIDE = "rounded-[20px] border border-hairline bg-page p-4";

// P3-W13-S01: the Play tab (§6.1, §6.3). Each game is playable once its own slice
// lands. Guests play here and only here (ADR-0029); signed-out visitors can start one.
// Wide screens follow the design's Play hub: the games in tiles, the battles below and
// the player's rating, streak and next tournament beside them.
export default async function PlayPage(props: {
  searchParams: Promise<{
    sprint?: string | string[];
    estimation?: string | string[];
    daily?: string | string[];
  }>;
}) {
  const actor = await sessionReader().current(await headers());
  // Guests have no username: Play is theirs without one (ADR-0029).
  if (actor !== null && !actor.isGuest)
    await requireUsername(actor.userId, "/play");
  // P3-W15-S05: finished live matches count toward mastery and review (guests too).
  if (actor !== null) await applyMatchEvidence(actor);
  const { sprint, estimation, daily } = await props.searchParams;
  const [allowed, chosen, today, rating, adjustments] =
    actor === null
      ? [null, null, null, null, []]
      : await Promise.all([
          Promise.all(
            GAMES.map((g) => entitlements().can(actor.userId, g.capability)),
          ),
          preferences().get(actor.userId),
          quizzes().dailyStatus(actor.userId),
          // P3-W16-S04 (MATCH-2): the one quick-game rating, as the worker last set it.
          playerRatings().of(actor.userId),
          // P3-W18-S02 (§6.9): confirmed fair-play penalties, shown with it.
          playerRatings().adjustments(actor.userId),
        ]);
  // P3-W16-S04 (Q-P3-23): the sprint's live 1v1, with both games on the plan and live
  // games configured.
  const live = gameEnv() !== null && allowedFor(allowed, "play.live") === true;
  // P5-W32, P6-W42 (MATCH-7): the lobbies' next ranked window and the player's
  // registration in it, for the battles on their plan; and the next HLD tournament
  // still taking registrations (P6-W43).
  const lld = live && allowedFor(allowed, "play.battle") === true;
  const hld = actor !== null && allowedFor(allowed, "play.hld") === true;
  const [next] = lld || hld ? windowsFrom(new Date(), windowTimeZone()) : [];
  const [lldIn, hldIn, cup] =
    actor === null
      ? [null, null, null]
      : await Promise.all([
          lld && next !== undefined
            ? battleWindows().registration(next, actor.userId)
            : null,
          hld && next !== undefined
            ? hldWindows().registration(next, actor.userId)
            : null,
          hld ? nextCup(actor.userId) : null,
        ]);
  return (
    <main className="mx-auto flex max-w-xl flex-col gap-6 px-4 pt-6 pb-[calc(6rem+env(safe-area-inset-bottom))] lg:mx-0 lg:grid lg:max-w-none lg:grid-cols-[minmax(0,1fr)_16.5rem] lg:content-start lg:gap-x-6 lg:gap-y-5 lg:pt-7 lg:pr-6 lg:pl-58">
      <header className="lg:col-start-1">
        <h1 className="text-display lg:text-[34px] lg:tracking-[-0.03em]">
          Play
        </h1>
        <p className="mt-1 text-ink-muted">
          Quick games on what you read. What you miss comes back as reading.
        </p>
        {/* P3-W14-S06 (§6.7): every board, for players signed in or guests. Wide
            screens have it in the rating card beside. */}
        {actor === null ? null : (
          <Link
            href="/play/boards"
            className="mt-3 inline-flex rounded-full border border-hairline px-4 py-2 text-sm font-semibold lg:hidden"
          >
            Boards
          </Link>
        )}
        {/* P3-W17-S03: a private live match by link. */}
        {live ? (
          <Link
            href="/play/challenge"
            className="mt-3 ml-2 inline-flex rounded-full border border-hairline px-4 py-2 text-sm font-semibold lg:ml-0"
          >
            Challenge a friend
          </Link>
        ) : null}
        {rating === null ? null : (
          <p className="mt-3 flex items-center gap-3 text-sm font-semibold tabular-nums lg:hidden">
            Rating {Math.round(rating)}
            {/* P3-W16-S06 (Q-P3-13): this month's quick-game season. */}
            <Link
              href="/play/boards?game=season"
              className="underline underline-offset-2"
            >
              Season board
            </Link>
          </p>
        )}
        <Adjustments list={adjustments} className="lg:hidden" />
      </header>
      {actor === null ? null : (
        <aside className="hidden lg:col-start-2 lg:row-span-6 lg:row-start-1 lg:flex lg:flex-col lg:gap-3">
          {rating === null ? null : (
            <RatingCard rating={rating} adjustments={adjustments} />
          )}
          {today === null ? null : <StreakCard status={today} />}
          {cup === null ? null : (
            <CupCard cup={cup.cup} registered={cup.registered} />
          )}
        </aside>
      )}
      <TabBar current="play" firstName={chosen?.firstName ?? null} />
      {next !== undefined && (lld || hld) ? (
        <WindowHero
          at={next}
          registered={
            lldIn !== null ? "LLD" : hldIn !== null ? "System design" : null
          }
          lld={lld}
          hld={hld}
        />
      ) : null}
      {actor?.isGuest === true ? (
        <p className="text-sm text-ink-muted lg:col-start-1">
          <Link href="/sign-up" className="underline underline-offset-2">
            Sign up to keep your progress
          </Link>
        </p>
      ) : null}
      {/* Start found nothing the player wasn't asked this week (Q-P3-04). */}
      {sprint === "none" ? (
        <p
          role="status"
          className="rounded-2xl bg-well px-4 py-3 text-sm lg:col-start-1"
        >
          You&apos;ve answered every question we have this week. New ones arrive
          as articles come in.
        </p>
      ) : null}
      {estimation === "none" ? (
        <p
          role="status"
          className="rounded-2xl bg-well px-4 py-3 text-sm lg:col-start-1"
        >
          You&apos;ve answered every estimation question we have this week. Try
          again in a few days.
        </p>
      ) : null}
      {daily === "none" ? (
        <p
          role="status"
          className="rounded-2xl bg-well px-4 py-3 text-sm lg:col-start-1"
        >
          There&apos;s no daily challenge today.
        </p>
      ) : null}
      <div className="flex flex-col gap-3 lg:col-start-1 lg:gap-5">
        <ul className="grid gap-3 sm:grid-cols-2 lg:gap-3.5">
          {QUICK.map((game) => (
            <li key={game.name}>
              <Card className="flex h-full flex-col gap-2 p-5 lg:rounded-[18px] lg:p-3.5 lg:shadow-none">
                <span
                  className={`hidden size-10 items-center justify-center rounded-xl lg:mb-1 lg:flex ${game.tint}`}
                >
                  {game.icon}
                </span>
                <h2 className="text-title lg:text-[15px] lg:leading-tight lg:font-semibold lg:tracking-normal">
                  {game.name}
                </h2>
                <p className="text-sm font-semibold lg:-mt-1.5 lg:text-[13px] lg:font-normal lg:text-ink-muted">
                  {game.format}
                </p>
                <p className="text-sm text-ink-muted lg:text-[13px]">
                  {game.win}
                </p>
                <Action
                  game={game}
                  allowed={allowedFor(allowed, game.capability)}
                  signedIn={actor !== null}
                  live={live}
                  today={today}
                />
              </Card>
            </li>
          ))}
        </ul>
        {/* The design's heading, though the section holds LLD too; its name says so. */}
        <section aria-label="Battles" className="contents">
          <h2 className="hidden text-section lg:block">
            System design battles
          </h2>
          <ul className="grid gap-3 sm:grid-cols-2 lg:gap-3.5">
            {BATTLES.map((game) => (
              <li key={game.name}>
                <Card className="flex h-full flex-col gap-2 p-5 lg:flex-row lg:items-start lg:gap-4 lg:rounded-[22px] lg:p-[18px] lg:shadow-none">
                  <span
                    className={`hidden size-16 shrink-0 items-center justify-center rounded-2xl lg:flex ${game.tint}`}
                  >
                    {game.icon}
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col gap-2 lg:self-stretch">
                    <div className="flex items-center justify-between">
                      <h2 className="text-title lg:text-section lg:tracking-normal">
                        {game.name}
                      </h2>
                      <span className="hidden text-[13px] text-ink-muted lg:inline">
                        {game.minutes}
                      </span>
                    </div>
                    <p className="text-sm font-semibold lg:font-normal lg:text-ink-muted">
                      {game.format}
                    </p>
                    <p className="text-sm text-ink-muted">{game.win}</p>
                    <Action
                      game={game}
                      allowed={allowedFor(allowed, game.capability)}
                      signedIn={actor !== null}
                      live={live}
                      today={today}
                    />
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      </div>
      {actor === null ? (
        <Card className="flex flex-col gap-4 p-5 lg:col-start-1">
          <h2 className="text-title">Play without an account</h2>
          <p className="text-sm text-ink-muted">
            Interval is in private beta: a guest needs an invite code too.
          </p>
          <GuestForm />
          <p className="text-sm">
            Or{" "}
            <Link href="/join" className="font-semibold underline">
              join
            </Link>{" "}
            or{" "}
            <Link href="/sign-in" className="font-semibold underline">
              sign in
            </Link>
            .
          </p>
        </Card>
      ) : null}
    </main>
  );
}

// A game card's way in: its own start, the lobby, or why it can't be played.
function Action({
  game,
  allowed,
  signedIn,
  live,
  today,
}: {
  game: Game;
  allowed: boolean | null;
  signedIn: boolean;
  live: boolean;
  today: DailyStatus | null;
}) {
  if (allowed === false)
    return (
      <p className="mt-auto pt-2 text-sm text-ink-muted">Not on your plan</p>
    );
  if (game.capability === "play.live" && live)
    // P3-W16-S05 (Q-P3-24): live only.
    return (
      <Link
        href="/play/live/fastest-finger"
        className={`mt-auto self-start ${ACT}`}
      >
        Play live
      </Link>
    );
  if (
    (game.capability === "play.battle" && live) ||
    (game.capability === "play.hld" && signedIn)
  )
    return (
      <div className="mt-auto flex flex-wrap gap-2 pt-2 lg:pt-1">
        <Link
          href={game.capability === "play.hld" ? "/hld/play" : "/play/battle"}
          className={ACT}
        >
          <span className="lg:hidden">Battle</span>
          <span className="hidden lg:inline">Find match</span>
        </Link>
        {/* The design's Solo practice: HLD's practice (P6-W42); LLD has none of its
            own (its casual queue turns solo after 60 s, in the lobby). */}
        {game.capability === "play.hld" ? (
          <Link href="/hld/practice" className={`hidden lg:inline ${QUIET}`}>
            Solo practice
          </Link>
        ) : null}
      </div>
    );
  if (game.capability === "play.daily" && today !== null)
    return <DailyPlay status={today} />;
  if (game.start !== undefined && signedIn)
    return (
      <div className="mt-auto flex flex-wrap items-center gap-3 pt-2">
        <form action={game.start.action}>
          <button type="submit" className={`cursor-pointer ${ACT}`}>
            {game.start.label}
          </button>
        </form>
        {game.capability === "play.sprint" && live ? (
          <Link href="/play/live/sprint" className={QUIET}>
            Play 1v1 live
          </Link>
        ) : null}
      </div>
    );
  return (
    <p className="mt-auto pt-2 text-sm text-ink-muted">
      {game.start !== undefined ||
      (game.capability === "play.live" && gameEnv() !== null)
        ? "Play as a guest below, or sign in"
        : "Coming later"}
    </p>
  );
}

function Adjustments({
  list,
  className = "",
}: {
  list: { penalty: number; playedAt: Date }[];
  className?: string;
}) {
  return list.map((a) => (
    <p
      key={a.playedAt.toISOString()}
      className={`mt-1 text-sm text-ink-muted tabular-nums ${className}`}
    >
      Fair-play adjustment:{" "}
      {a.penalty > 0
        ? `−${String(Math.round(a.penalty))}`
        : "no rating removed"}{" "}
      (match of{" "}
      {a.playedAt.toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      })}
      )
    </p>
  ));
}

// The design's hero, from the lobbies' own data: the next ranked window (MATCH-7),
// and whether the player is registered for it.
function WindowHero({
  at,
  registered,
  lld,
  hld,
}: {
  at: Date;
  registered: "LLD" | "System design" | null;
  lld: boolean;
  hld: boolean;
}) {
  return (
    <section
      aria-label="Next ranked window"
      className="hidden overflow-hidden rounded-3xl border border-hairline bg-page shadow-card lg:col-start-1 lg:flex"
    >
      <div className="flex w-[140px] shrink-0 items-center justify-center bg-(--system-design-tint)">
        <svg aria-hidden="true" viewBox="0 0 110 90" className="w-[110px]">
          <path d="M36 20 58 31 36 42 14 31z" fill="var(--system-design-top)" />
          <path d="M14 31 36 42v22L14 53z" fill="var(--system-design-left)" />
          <path d="M36 42 58 31v22L36 64z" fill="var(--system-design-right)" />
          <path
            d="M58 52 72 50"
            stroke="var(--system-design-line)"
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray="2 7"
          />
          <path
            d="M72 34v30a17 6 0 0 0 34 0V34z"
            fill="var(--system-design-left)"
          />
          <ellipse
            cx="89"
            cy="34"
            rx="17"
            ry="6"
            fill="var(--system-design-top)"
          />
        </svg>
      </div>
      <div className="flex flex-1 flex-wrap items-center gap-5 px-[22px] py-5">
        <NextWindow
          at={at.toISOString()}
          label={registered === null ? "Ranked battles" : "You're registered"}
          title={
            registered === null
              ? "The next ranked window,"
              : `${registered} battle,`
          }
          body={
            registered === null
              ? "Register in a lobby until 5 minutes before it starts."
              : "You're grouped by rating when it starts."
          }
        />
        <div className="flex gap-2">
          {lld && (registered === null || registered === "LLD") ? (
            <Link href="/play/battle" className={QUIET}>
              {registered === null ? "LLD lobby" : "Go to the lobby"}
            </Link>
          ) : null}
          {hld && (registered === null || registered === "System design") ? (
            <Link href="/hld/play" className={QUIET}>
              {registered === null ? "System design lobby" : "Go to the lobby"}
            </Link>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function RatingCard({
  rating,
  adjustments,
}: {
  rating: number;
  adjustments: { penalty: number; playedAt: Date }[];
}) {
  return (
    <section
      aria-label="Rating"
      className="flex flex-col gap-3 rounded-[22px] border border-hairline bg-page p-[18px] shadow-card"
    >
      <div className="flex items-center gap-2.5">
        <span className="flex size-9 items-center justify-center rounded-[10px] bg-(--distributed-systems-tint)">
          <svg aria-hidden="true" viewBox="0 0 24 24" className="size-[22px]">
            <path
              d="M12 3 20 9 12 21 4 9z"
              fill="var(--distributed-systems-left)"
            />
            <path d="M12 3 20 9H4z" fill="var(--distributed-systems-top)" />
          </svg>
        </span>
        <div className="flex-1">
          <p className="font-semibold">Rating</p>
          <p className="text-[13px] text-ink-muted">Quick games</p>
        </div>
        <span className="text-[22px] font-bold tabular-nums">
          {Math.round(rating)}
        </span>
      </div>
      <Adjustments list={adjustments} className="mt-0 text-[13px]" />
      <div className="flex gap-2 text-sm font-semibold">
        <Link
          href="/play/boards?game=season"
          className="flex-1 rounded-[10px] bg-well px-2.5 py-[7px] text-center"
        >
          Season board
        </Link>
        <Link
          href="/play/boards"
          className="flex-1 rounded-[10px] bg-well px-2.5 py-[7px] text-center"
        >
          Boards
        </Link>
      </div>
    </section>
  );
}

// Q-P3-07: the daily challenge's streak, a dot a day for the last week of it.
function StreakCard({ status }: { status: DailyStatus }) {
  const { today, streak } = status;
  const days = Math.min(streak.days, 7);
  return (
    <section aria-label="Streak" className={`flex flex-col gap-2 ${SIDE}`}>
      <div className="flex items-center gap-2.5">
        <span aria-hidden="true" className="flex gap-[3px]">
          {Array.from({ length: 7 }, (_, i) => (
            <span
              key={i}
              className={`size-[9px] rounded-full ${i < days ? "bg-go" : "border-[1.5px] border-ink-muted"}`}
            />
          ))}
        </span>
        <span className="text-[15px] font-semibold">
          {streakText(streak) ?? "No streak yet"}
        </span>
      </div>
      <p className="text-[13px] text-ink-muted">
        {today === "none"
          ? "No challenge today."
          : today !== "open" && today.finished
            ? "Done for today."
            : "Today's challenge is still to play."}
      </p>
    </section>
  );
}

// P6-W43 (Q-P6-07): the next HLD tournament still taking registrations, and whether
// the player is already in it.
async function nextCup(
  userId: string,
): Promise<{ cup: HldTournament; registered: boolean } | null> {
  const cup = (await hldTournaments().list()).find(
    (t) => t.round === 0 && t.finishedAt === null,
  );
  if (cup === undefined) return null;
  const entries = await hldTournaments().entries(cup.id);
  return { cup, registered: entries.some((e) => e.userId === userId) };
}

function CupCard({
  cup,
  registered,
}: {
  cup: HldTournament;
  registered: boolean;
}) {
  return (
    <section aria-label="Next tournament" className={SIDE}>
      <p className="text-[15px] font-semibold">{cup.name}</p>
      <p className="mt-0.5 text-[13px] text-ink-muted tabular-nums">
        {cup.startsAt.toLocaleString("en-GB", {
          weekday: "short",
          day: "numeric",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
          timeZone: "UTC",
        })}{" "}
        UTC · the {cup.league} league
      </p>
      <Link
        href={`/hld/tournaments/${cup.id}`}
        className="mt-3 flex h-10 items-center justify-center rounded-xl border-[1.5px] border-track text-sm font-semibold"
      >
        {registered ? "You're registered" : "Register"}
      </Link>
    </section>
  );
}
