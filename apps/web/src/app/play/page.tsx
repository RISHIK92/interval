import type { Capability } from "@interval/db";
import { headers } from "next/headers";
import Link from "next/link";
import type { ReactNode } from "react";
import { gameEnv, windowTimeZone } from "../../env";
import { windowStatus, windowsFrom } from "../../server/battle-windows";
import {
  battleWindows,
  entitlements,
  hldWindows,
  playerRatings,
  preferences,
  quizzes,
  sessionReader,
} from "../../server/container";
import { type DailyStatus, LIVE_QUESTIONS } from "../../server/ports";
import { DailyPlay } from "../DailyCard";
import {
  startDailyAction,
  startEstimationAction,
  startSprintAction,
} from "../quiz/actions";
import { streakText } from "../streakText";
import { requireUsername } from "../username/gate";
import { applyMatchEvidence } from "./live/evidence";
import { Card } from "../ui/Card";
import { Page } from "../ui/Page";
import { GuestForm } from "./GuestForm";
import { type QuickGame, QuickGames } from "./QuickGames";
import { RankedBattles } from "./RankedBattles";

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
// with their slices. `icon` and `tint`: the wide layout's tile; `web`: the wide
// layout's panel for the chosen game (Play hub, web), where the daily challenge is in
// the rail instead.
type Game = {
  name: string;
  format: string;
  win: string;
  capability: Capability;
  start?: { action: () => Promise<void>; label: string };
  icon: ReactNode;
  tint: string;
  web?: { format: string; about: string; panel: string; art: ReactNode };
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
    web: {
      format: "Solo or 1v1",
      about: "Most correct answers in 60 seconds.",
      panel: "bg-(--distributed-systems-tint)",
      art: (
        <svg aria-hidden="true" viewBox="0 0 64 72" className="w-[60px]">
          <rect
            x="24"
            y="1"
            width="16"
            height="7"
            rx="3"
            fill="var(--distributed-systems-right)"
          />
          <rect
            x="29"
            y="7"
            width="6"
            height="7"
            fill="var(--distributed-systems-top)"
          />
          <circle
            cx="32"
            cy="42"
            r="25"
            fill="none"
            stroke="var(--distributed-systems-top)"
            strokeWidth="7"
          />
          <path
            d="M32 42V24a18 18 0 0 1 16 26z"
            fill="var(--distributed-systems-right)"
          />
          <path
            d="M32 42 22 50"
            stroke="var(--distributed-systems-right)"
            strokeWidth="5"
            strokeLinecap="round"
          />
        </svg>
      ),
    },
  },
  {
    name: "Fastest finger",
    format: `1v1 live, ${String(LIVE_QUESTIONS.fastest_finger)} rounds`,
    win: "First correct answer takes each round",
    capability: "play.live",
    icon: line(<path d="M13 2 4 14h7l-1 8 9-12h-7z" />),
    tint: "bg-live/10 text-wrong",
    web: {
      format: `1v1 live · ${String(LIVE_QUESTIONS.fastest_finger)} rounds`,
      about: "First correct answer takes each round.",
      panel: "bg-live/10",
      art: (
        <svg aria-hidden="true" viewBox="0 0 64 72" className="w-[54px]">
          <path d="M38 2 8 42h22l-6 28 32-42H34z" className="fill-live" />
          <path
            d="M38 2 8 42h22l-6 28"
            fill="none"
            className="stroke-wrong"
            strokeWidth="3"
            strokeLinejoin="round"
          />
        </svg>
      ),
    },
  },
  {
    name: "Estimation",
    format: "Solo",
    win: "Scored by how many times off the answer is; full points within 1.25× of the answer",
    capability: "play.estimation",
    start: { action: startEstimationAction, label: "Start a round" },
    icon: line(<path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />),
    tint: "bg-(--databases-tint) text-(--databases-line)",
    web: {
      format: "Solo",
      about: "Full points within 1.25× of the answer.",
      panel: "bg-(--databases-tint)",
      art: (
        <svg aria-hidden="true" viewBox="0 0 72 64" className="w-[64px]">
          <rect
            x="8"
            y="30"
            width="12"
            height="26"
            rx="3"
            fill="var(--databases-top)"
          />
          <rect
            x="26"
            y="8"
            width="12"
            height="48"
            rx="3"
            fill="var(--databases-left)"
          />
          <rect
            x="44"
            y="22"
            width="12"
            height="34"
            rx="3"
            fill="var(--databases-right)"
          />
          <path
            d="M2 60h68"
            stroke="var(--databases-line)"
            strokeWidth="4"
            strokeLinecap="round"
          />
        </svg>
      ),
    },
  },
];

const BATTLES: (Game & { minutes: string; blurb: string })[] = [
  // P5-W32 (§6.5, §6.6): ranked windows and the casual queue start at /play/battle.
  {
    name: "LLD battle",
    format:
      "Ranked windows in rooms of up to 4, or a casual 1v1, about 45 minutes",
    win: "Most points from passed tests; a tie goes to whoever got there first",
    capability: "play.battle",
    minutes: "45 min",
    blurb: "Casual 1v1 · ranked rooms of up to 4",
    icon: (
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="size-[26px]"
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
    blurb: "1v1 or solo · practice any time",
    icon: (
      <svg aria-hidden="true" viewBox="8 6 24 26" className="size-[26px]">
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

// A game's way in: its own start, the lobby, or why it can't be played. Phones and
// wide screens draw it differently; this decides it once for both.
type Way =
  | { kind: "note"; text: string }
  | { kind: "live"; href: string }
  | { kind: "battle"; href: string; practice: string }
  | { kind: "daily"; status: DailyStatus }
  | {
      kind: "start";
      action: () => Promise<void>;
      label: string;
      live: string | null;
    };

function wayIn(
  game: Game,
  allowed: boolean | null,
  signedIn: boolean,
  live: boolean,
  today: DailyStatus | null,
): Way {
  if (allowed === false) return { kind: "note", text: "Not on your plan" };
  // P3-W16-S05 (Q-P3-24): live only.
  if (game.capability === "play.live" && live)
    return { kind: "live", href: "/play/live/fastest-finger" };
  if (
    (game.capability === "play.battle" && live) ||
    (game.capability === "play.hld" && signedIn)
  )
    // Their practice: HLD's practice (P6-W42); LLD's (ADR-0048).
    return game.capability === "play.hld"
      ? {
          kind: "battle",
          href: "/hld/play",
          practice: "/hld/practice",
        }
      : {
          kind: "battle",
          href: "/play/battle",
          practice: "/play/battle/practice",
        };
  if (game.capability === "play.daily" && today !== null)
    return { kind: "daily", status: today };
  if (game.start !== undefined && signedIn)
    return {
      kind: "start",
      ...game.start,
      live:
        game.capability === "play.sprint" && live ? "/play/live/sprint" : null,
    };
  return {
    kind: "note",
    text:
      game.start !== undefined ||
      (game.capability === "play.live" && gameEnv() !== null)
        ? "Play as a guest below, or sign in"
        : "Coming later",
  };
}

// Phones: the pill as it was.
const ACT = "rounded-full bg-ink px-5 py-2.5 font-semibold text-page";
const QUIET = "rounded-full border border-hairline px-5 py-2.5 font-semibold";
// Wide screens (Play hub, web): the black play button and the outlined one.
const PLAY =
  "flex h-10 shrink-0 cursor-pointer items-center gap-2 rounded-xl bg-ink px-4 text-[15px] font-semibold text-page";
const OUTLINE =
  "flex h-[42px] items-center rounded-xl border-[1.5px] border-ink px-4 text-[15px] font-semibold";
const TRIANGLE = (
  <svg aria-hidden="true" viewBox="0 0 10 10" className="size-2">
    <path d="M1.5 0.5 9.5 5l-8 4.5z" fill="currentColor" />
  </svg>
);

// P3-W13-S01: the Play tab (§6.1, §6.3). Each game is playable once its own slice
// lands. Guests play here and only here (ADR-0029); signed-out visitors can start one.
// Wide screens follow the design's Play hub: pick a quick game and how to play it, the
// design battles below, and the next ranked window, the rating and the daily challenge
// in the rail.
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
  const signedIn = actor !== null;
  // P3-W16-S04 (Q-P3-23): the sprint's live 1v1, with both games on the plan and live
  // games configured.
  const live = gameEnv() !== null && allowedFor(allowed, "play.live") === true;
  // P5-W32, P6-W42 (MATCH-7): the lobbies' next ranked window and the player's
  // registration in it, for the battles on their plan.
  const lld = live && allowedFor(allowed, "play.battle") === true;
  const hld = signedIn && allowedFor(allowed, "play.hld") === true;
  const now = new Date();
  const [next] = lld || hld ? windowsFrom(now, windowTimeZone()) : [];
  const [lldIn, hldIn] =
    actor === null || next === undefined
      ? [null, null]
      : await Promise.all([
          lld ? battleWindows().registration(next, actor.userId) : null,
          hld ? hldWindows().registration(next, actor.userId) : null,
        ]);
  const way = (game: Game) =>
    wayIn(game, allowedFor(allowed, game.capability), signedIn, live, today);
  const ranked = [
    ...(lld
      ? [{ game: "lld" as const, registered: lldIn?.battleMode ?? null }]
      : []),
    ...(hld
      ? [{ game: "hld" as const, registered: hldIn?.battleMode ?? null }]
      : []),
  ];
  const rail =
    actor === null ? undefined : (
      <>
        {next === undefined || ranked.length === 0 ? null : (
          <RankedBattles
            at={next.toISOString()}
            status={windowStatus(next, now)}
            games={ranked}
          />
        )}
        {rating === null ? null : (
          <RatingCard rating={rating} adjustments={adjustments} />
        )}
        {today === null ? null : <DailyRailCard status={today} />}
      </>
    );
  return (
    <Page
      tab="play"
      firstName={chosen?.firstName ?? null}
      rail={rail}
      railLabel="Your games"
      className="flex flex-col gap-6 lg:gap-7"
    >
      <header className="lg:flex lg:items-end lg:justify-between lg:gap-6">
        <div>
          <h1 className="text-display lg:text-[34px] lg:tracking-[-0.03em]">
            Play
          </h1>
          <p className="mt-1 text-ink-muted lg:mt-1.5 lg:text-ink-soft">
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
              className="mt-3 ml-2 inline-flex rounded-full border border-hairline px-4 py-2 text-sm font-semibold lg:hidden"
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
        </div>
        {live ? (
          <Link
            href="/play/challenge"
            className="hidden h-10 shrink-0 items-center gap-2 rounded-full border-[1.5px] border-hairline-strong px-4 text-[15px] font-semibold lg:inline-flex"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              className="size-[18px]"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="9" cy="8" r="4" />
              <path d="M2 21v-1a6 6 0 0 1 6-6h2a6 6 0 0 1 6 6v1M19 8v6M16 11h6" />
            </svg>
            Challenge a friend
          </Link>
        ) : null}
      </header>
      {actor?.isGuest === true ? (
        <p className="text-sm text-ink-muted">
          <Link href="/sign-up" className="underline underline-offset-2">
            Sign up to keep your progress
          </Link>
        </p>
      ) : null}
      {/* Start found nothing the player wasn't asked this week (Q-P3-04). */}
      {sprint === "none" ? (
        <p role="status" className="rounded-2xl bg-well px-4 py-3 text-sm">
          You&apos;ve answered every question we have this week. New ones arrive
          as articles come in.
        </p>
      ) : null}
      {estimation === "none" ? (
        <p role="status" className="rounded-2xl bg-well px-4 py-3 text-sm">
          You&apos;ve answered every estimation question we have this week. Try
          again in a few days.
        </p>
      ) : null}
      {daily === "none" ? (
        <p role="status" className="rounded-2xl bg-well px-4 py-3 text-sm">
          There&apos;s no daily challenge today.
        </p>
      ) : null}
      {/* Phones: the mobile design's cards, every game with its way in. */}
      <div className="flex flex-col gap-3 lg:hidden">
        <ul className="grid gap-3 sm:grid-cols-2">
          {QUICK.map((game) => (
            <li key={game.name}>
              <Card className="flex h-full flex-col gap-2 p-5">
                <h2 className="text-title">{game.name}</h2>
                <p className="text-sm font-semibold">{game.format}</p>
                <p className="text-sm text-ink-muted">{game.win}</p>
                <Action way={way(game)} />
              </Card>
            </li>
          ))}
        </ul>
        <section aria-label="Battles" className="contents">
          <ul className="grid gap-3 sm:grid-cols-2">
            {BATTLES.map((game) => (
              <li key={game.name}>
                <Card className="flex h-full flex-col gap-2 p-5">
                  <h2 className="text-title">{game.name}</h2>
                  <p className="text-sm font-semibold">{game.format}</p>
                  <p className="text-sm text-ink-muted">{game.win}</p>
                  <Action way={way(game)} />
                </Card>
              </li>
            ))}
          </ul>
        </section>
      </div>
      {/* Wide screens: the design's Play hub. */}
      <Card className="hidden flex-col gap-4 p-[21px] lg:flex">
        <div className="flex items-baseline justify-between">
          <h2 className="text-[18px] font-bold tracking-[-0.01em]">
            Quick games
          </h2>
          <p className="text-[13px] text-ink-muted">Pick a mode, then play</p>
        </div>
        <QuickGames
          games={QUICK.flatMap((game) =>
            game.web === undefined
              ? []
              : [quickGame(game, game.web, way(game))],
          )}
        />
      </Card>
      <section
        aria-label="Design battles"
        className="hidden flex-col gap-3.5 lg:flex"
      >
        <div className="flex items-baseline justify-between">
          <h2 className="text-[18px] font-bold tracking-[-0.01em]">
            Design battles
          </h2>
          <p className="text-[13px] text-ink-muted">Casual matches any time</p>
        </div>
        <ul className="grid grid-cols-2 gap-3.5">
          {BATTLES.map((game) => (
            <li key={game.name}>
              <BattleCard game={game} way={way(game)} />
            </li>
          ))}
        </ul>
      </section>
      {actor === null ? (
        <Card className="flex flex-col gap-4 p-5">
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
    </Page>
  );
}

// Phones: a game card's way in.
function Action({ way }: { way: Way }) {
  switch (way.kind) {
    case "note":
      return <p className="mt-auto pt-2 text-sm text-ink-muted">{way.text}</p>;
    case "live":
      return (
        <Link href={way.href} className={`mt-auto self-start ${ACT}`}>
          Play live
        </Link>
      );
    case "battle":
      return (
        <div className="mt-auto flex flex-wrap gap-2 pt-2">
          <Link href={way.href} className={ACT}>
            Battle
          </Link>
        </div>
      );
    case "daily":
      return <DailyPlay status={way.status} />;
    case "start":
      return (
        <div className="mt-auto flex flex-wrap items-center gap-3 pt-2">
          <form action={way.action}>
            <button type="submit" className={`cursor-pointer ${ACT}`}>
              {way.label}
            </button>
          </form>
          {way.live === null ? null : (
            <Link href={way.live} className={QUIET}>
              Play 1v1 live
            </Link>
          )}
        </div>
      );
  }
}

// Wide screens: a quick game's tile and panel, with its ways in made here so the
// server's start actions stay on the server.
function quickGame(
  game: Game,
  web: NonNullable<Game["web"]>,
  way: Way,
): QuickGame {
  const solo =
    way.kind === "start" ? (
      <form action={way.action} className="shrink-0">
        <button type="submit" className={PLAY}>
          {TRIANGLE}
          Play solo
        </button>
      </form>
    ) : null;
  const liveHref =
    way.kind === "start" ? way.live : way.kind === "live" ? way.href : null;
  return {
    name: game.name,
    format: web.format,
    about: web.about,
    icon: game.icon,
    tint: game.tint,
    panel: web.panel,
    art: web.art,
    solo,
    live:
      liveHref === null ? null : (
        <Link href={liveHref} className={PLAY}>
          {TRIANGLE}
          Play 1v1 live
        </Link>
      ),
    note: way.kind === "note" ? way.text : "",
  };
}

function BattleCard({
  game,
  way,
}: {
  game: (typeof BATTLES)[number];
  way: Way;
}) {
  return (
    <div className="flex h-full flex-col gap-5 rounded-[20px] border border-hairline bg-card p-[18px]">
      <div className="flex items-start gap-4">
        <span
          className={`flex size-13 shrink-0 items-center justify-center rounded-[14px] ${game.tint}`}
        >
          {game.icon}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[17px] leading-snug font-bold">{game.name}</h3>
          <p className="mt-1 text-[13px] leading-snug text-ink-muted">
            {game.blurb}
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-well px-2.5 py-1 text-xs font-semibold">
          {game.minutes}
        </span>
      </div>
      <div className="mt-auto flex items-center gap-5">
        {way.kind === "battle" ? (
          <>
            <Link href={way.href} className={OUTLINE}>
              Find a match
            </Link>
            <Link
              href={way.practice}
              className="text-[15px] font-semibold text-ink-soft"
            >
              Practice
            </Link>
          </>
        ) : (
          <p className="text-sm text-ink-muted">
            {way.kind === "note" ? way.text : null}
          </p>
        )}
      </div>
    </div>
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

const RAIL =
  "flex flex-col gap-3 rounded-[22px] border border-hairline bg-card p-[18px] shadow-card";
const RAIL_BUTTON =
  "flex h-9 flex-1 items-center justify-center rounded-[10px] bg-well text-sm font-semibold";

function RatingCard({
  rating,
  adjustments,
}: {
  rating: number;
  adjustments: { penalty: number; playedAt: Date }[];
}) {
  return (
    <section aria-label="Rating" className={RAIL}>
      <div className="flex items-center gap-3">
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
          <p className="text-[15px] leading-tight font-semibold">Rating</p>
          <p className="text-xs text-ink-muted">Quick games</p>
        </div>
        <span className="text-[26px] leading-none font-bold tracking-[-0.02em] tabular-nums">
          {Math.round(rating)}
        </span>
      </div>
      <Adjustments list={adjustments} className="mt-0 text-[13px]" />
      <div className="flex gap-2">
        <Link href="/play/boards?game=season" className={RAIL_BUTTON}>
          Season board
        </Link>
        <Link href="/play/boards" className={RAIL_BUTTON}>
          Boards
        </Link>
      </div>
    </section>
  );
}

// §6.3, Q-P3-07: the daily challenge, a dot a day for the last week of its streak, and
// today's way in or result.
function DailyRailCard({ status }: { status: DailyStatus }) {
  const { today, streak } = status;
  const days = Math.min(streak.days, 7);
  return (
    <section aria-label="Daily challenge" className={RAIL}>
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-(--review-tint) text-(--review-line)">
          {QUICK[0]?.icon}
        </span>
        <div>
          <h2 className="text-[15px] leading-tight font-semibold">
            Daily challenge
          </h2>
          <p className="mt-0.5 text-xs leading-snug text-ink-muted">
            Same set for everyone, one attempt
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2.5">
        <span aria-hidden="true" className="flex gap-[3px]">
          {Array.from({ length: 7 }, (_, i) => (
            <span
              key={i}
              className={`size-[9px] rounded-full ${i < days ? "bg-go" : "border border-ink-muted"}`}
            />
          ))}
        </span>
        <span className="text-[13px] font-semibold">
          {streakText(streak) ?? "No streak yet"}
        </span>
      </div>
      <div className="flex flex-col gap-2.5 rounded-xl bg-well px-3 py-2.5 text-[13px] leading-snug text-ink-soft">
        {today === "none" ? (
          <p>
            No challenge today. Your score shares as a card that keeps the
            questions hidden.
          </p>
        ) : today === "open" || !today.finished ? (
          <>
            <p>Your score shares as a card that keeps the questions hidden.</p>
            <form action={startDailyAction}>
              <button
                type="submit"
                className="h-9 w-full cursor-pointer rounded-[10px] bg-ink text-sm font-semibold text-page"
              >
                {today === "open"
                  ? "Start today's challenge"
                  : "Carry on with today's challenge"}
              </button>
            </form>
          </>
        ) : (
          <p>
            Today: {today.points} points ·{" "}
            <a
              href={`/quiz/${today.attemptId}/results?chip=3-8`}
              className="font-semibold text-ink underline underline-offset-2"
            >
              See your results
            </a>
          </p>
        )}
      </div>
    </section>
  );
}
