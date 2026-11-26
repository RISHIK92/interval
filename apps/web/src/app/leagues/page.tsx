import type { LeagueTier } from "@interval/db";
import { cookies, headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";
import { windowTimeZone } from "../../env";
import { boardName } from "../../server/boards";
import {
  entitlements,
  events,
  follows,
  leaderboards,
  leagues,
  playerUniversities,
  preferences,
  sessionReader,
} from "../../server/container";
import {
  leagueWeek,
  TIER_NAMES,
  TIERS,
  tierAbove,
  tierBelow,
  timeLeft,
  weekSoFar,
} from "../../server/leagues";
import type { LeagueCohort } from "../../server/ports";
import { visitId } from "../../server/visits";
import { buttonClass } from "../ui/Button";
import { PAGE_TITLE, Page, RailCard } from "../ui/Page";
import { requireUsername } from "../username/gate";
import { TierMark } from "./TierMark";

export const dynamic = "force-dynamic";

const HOW =
  "Each week you’re grouped with 30 people who play about as much as you. Points come from matches, battles and reading checkpoints. A new league starts every Monday.";

type Tab = "league" | "friends";

// ADR-0045 (Leagues, web): the player's weekly league, ranked, with the zones that move
// up and down when it closes on Monday; Friends ranks this week's points among those
// they follow; University and All-time are the existing boards. Guests aren't in
// leagues (ADR-0029), and a plan without play.league gets 404 (ADR-0036).
export default async function LeaguesPage(props: {
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const actor = await sessionReader().current(await headers());
  if (actor === null) redirect("/join");
  if (actor.isGuest) redirect("/sign-up");
  if (!(await entitlements().can(actor.userId, "play.league"))) notFound();
  await requireUsername(actor.userId, "/leagues");
  const tab: Tab =
    (await props.searchParams).tab === "friends" ? "friends" : "league";
  const now = new Date();
  const week = leagueWeek(now, windowTimeZone());
  const [chosen, mine, university] = await Promise.all([
    preferences().get(actor.userId),
    leagues().standing(actor.userId, week.start, week.todayFrom),
    universityRank(actor.userId, now),
  ]);
  events().emit(
    "league_viewed",
    { tab },
    { ...actor, sessionId: visitId(await cookies()) },
  );
  const friends =
    tab === "friends" ? await friendsPoints(actor.userId, week.start) : null;
  const { tier, cohort } = mine;
  const left = timeLeft(now, week.endsAt);
  const ends = "ends Sunday · ";
  return (
    <Page
      tab="leagues"
      firstName={chosen?.firstName ?? null}
      railLabel="About leagues"
      rail={
        <>
          <RailCard className="flex flex-col gap-3">
            <span className="text-[17px] font-semibold tracking-[-0.01em]">
              Tiers
            </span>
            <Tiers tier={tier} />
          </RailCard>
          <RailCard surface="bg-well" className="flex flex-col gap-1.5">
            <span className="text-[15px] font-semibold">How leagues work</span>
            <span className="text-sm leading-[1.55] text-ink-soft">{HOW}</span>
          </RailCard>
          {university === null ? null : (
            <RailCard href="/play/boards?game=season&scope=universities">
              <span className="block text-[13px] text-ink-muted">
                Your university
              </span>
              <span className="mt-0.5 block text-[17px] font-semibold tabular-nums">
                {`${university.name} · #${String(university.rank)} of ${String(university.count)}`}
              </span>
            </RailCard>
          )}
        </>
      }
      className="flex flex-col gap-5 lg:gap-[18px]"
    >
      {/* Phones reach Leagues from Play (ADR-0045); the sidebar does on wide screens. */}
      <Link href="/play" className="text-sm text-ink-muted underline lg:hidden">
        Back to Play
      </Link>
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <span
            aria-hidden="true"
            className="flex size-16 shrink-0 items-center justify-center rounded-[18px] bg-well"
          >
            <TierMark tier={tier} size="large" />
          </span>
          <div>
            <h1 className={PAGE_TITLE}>{TIER_NAMES[tier]} league</h1>
            <p className="mt-0.5 text-sm text-ink-muted">
              {cohort === null
                ? ends
                : `${String(cohort.size)} players at your pace · ${ends}`}
              <span className="font-semibold text-ink tabular-nums">
                {left.days}d {left.hours}h
              </span>
            </p>
          </div>
        </div>
        <Tabs tab={tab} />
      </header>
      {tab === "friends" ? (
        <Friends userId={actor.userId} friends={friends} />
      ) : cohort === null ? (
        <div className="flex flex-col items-start gap-4 rounded-[20px] border border-hairline bg-card p-5 shadow-card">
          <p className="text-ink-soft">
            Your first points this week put you in a league with players at your
            pace. Points come from matches, battles and reading checkpoints.
          </p>
          <Link href="/play" className={buttonClass()}>
            Play
          </Link>
        </div>
      ) : (
        <Standings cohort={cohort} tier={tier} userId={actor.userId} />
      )}
      <p className="text-sm leading-[1.55] text-ink-soft lg:hidden">{HOW}</p>
    </Page>
  );
}

// The season's universities board (Q-P3-13, C-17), unverified (ADR-0032).
async function universityRank(
  userId: string,
  now: Date,
): Promise<{ name: string; rank: number; count: number } | null> {
  const { university } = await playerUniversities().get(userId);
  if (university === null) return null;
  const board = boardName("season", "current", now);
  const [own, count] = await Promise.all([
    leaderboards().universityStanding(board, university.id),
    leaderboards().universityCount(board),
  ]);
  return own === null ? null : { name: university.name, rank: own.rank, count };
}

const TAB =
  "flex shrink-0 items-center rounded-[10px] px-3.5 text-sm font-medium text-ink-soft aria-[current=page]:bg-lift aria-[current=page]:font-semibold aria-[current=page]:text-ink aria-[current=page]:shadow-[0_1px_3px_rgba(16,18,23,0.14)]";

function Tabs({ tab }: { tab: Tab }) {
  return (
    <nav
      aria-label="Leaderboard"
      className="flex h-11 max-w-full gap-1 overflow-x-auto rounded-[14px] bg-well p-1"
    >
      <Link
        href="/leagues"
        aria-current={tab === "league" ? "page" : undefined}
        className={TAB}
      >
        League
      </Link>
      <Link
        href="/leagues?tab=friends"
        aria-current={tab === "friends" ? "page" : undefined}
        className={TAB}
      >
        Friends
      </Link>
      <Link href="/play/boards?game=season&scope=universities" className={TAB}>
        University
      </Link>
      <Link href="/play/boards" className={TAB}>
        All-time
      </Link>
    </nav>
  );
}

const CELL = "px-2 py-2.5";
const EDGE = "px-[18px] py-2.5";

// head: the third column's, when the table has one.
function Table({
  head,
  children,
}: {
  head: string | null;
  children: ReactNode;
}) {
  return (
    <div className="overflow-x-auto rounded-[20px] border border-hairline bg-card shadow-card">
      <table className="w-full border-collapse text-[15px]">
        <thead>
          <tr className="text-left text-[13px] text-ink-muted">
            <th className={`${EDGE} w-16 border-b border-hairline font-medium`}>
              Rank
            </th>
            <th className={`${CELL} border-b border-hairline font-medium`}>
              Player
            </th>
            {head === null ? null : (
              <th
                className={`${CELL} hidden border-b border-hairline font-medium sm:table-cell`}
              >
                {head}
              </th>
            )}
            <th
              className={`${EDGE} border-b border-hairline text-right font-medium`}
            >
              Points
            </th>
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function Row(props: {
  rank: number;
  name: string;
  week: string | null;
  points: number;
  mine: boolean;
  promoted: boolean;
}) {
  return (
    <tr
      aria-current={props.mine ? "true" : undefined}
      className={props.mine ? "bg-ink text-page" : ""}
    >
      <td
        className={`${EDGE} font-bold tabular-nums ${props.mine ? "" : props.promoted ? "text-go-text" : "text-ink-muted"}`}
      >
        {props.rank}
      </td>
      <td className={`${CELL} ${props.mine ? "font-bold" : "font-semibold"}`}>
        {props.name}
      </td>
      {props.week === null ? null : (
        <td
          className={`${CELL} hidden sm:table-cell ${props.mine ? "" : "text-ink-soft"}`}
        >
          {props.week}
        </td>
      )}
      <td className={`${EDGE} text-right font-bold tabular-nums`}>
        {props.points}
      </td>
    </tr>
  );
}

// The design's zone lines: dashed, in go above the promotion zone's end and in the
// error colour above the demotion zone.
function Zone({ up, children }: { up: boolean; children: ReactNode }) {
  return (
    <tr>
      <td
        colSpan={4}
        className={`border-t-2 border-dashed px-[18px] py-[7px] text-[13px] font-semibold ${up ? "border-go bg-go/10 text-go-text" : "border-wrong bg-wrong/10 text-wrong"}`}
      >
        {children}
      </td>
    </tr>
  );
}

function Standings({
  cohort,
  tier,
  userId,
}: {
  cohort: LeagueCohort;
  tier: LeagueTier;
  userId: string;
}) {
  const above = tierAbove(tier);
  const below = tierBelow(tier);
  const downFrom = cohort.rows.length - cohort.down;
  return (
    <Table head="This week">
      {cohort.rows.flatMap((r) => {
        const mine = r.userId === userId;
        const row = (
          <Row
            key={r.userId}
            rank={r.rank}
            name={mine ? "You" : (r.username ?? "Player")}
            week={weekSoFar(r, mine)}
            points={r.points}
            mine={mine}
            promoted={r.rank <= cohort.up}
          />
        );
        return [
          ...(below !== null && cohort.down > 0 && r.rank === downFrom + 1
            ? [
                <Zone key="down" up={false}>
                  Bottom {cohort.down} move down to {TIER_NAMES[below]}
                </Zone>,
              ]
            : []),
          row,
          ...(above !== null && cohort.up > 0 && r.rank === cohort.up
            ? [
                <Zone key="up" up>
                  Promotion zone above · top {cohort.up} move up to{" "}
                  {TIER_NAMES[above]}
                </Zone>,
              ]
            : []),
        ];
      })}
    </Table>
  );
}

// This week's league points among the player and those they follow (null: they
// follow nobody); equal points share a rank, as on the friends board (P3-W14-S05).
type FriendPoints = { userId: string; name: string; points: number }[];

async function friendsPoints(
  userId: string,
  weekStart: string,
): Promise<FriendPoints | null> {
  const followed = await follows().following(userId);
  if (followed.length === 0) return null;
  const names = new Map(followed.map((p) => [p.userId, p.username]));
  const points = await leagues().pointsOf(
    [userId, ...followed.map((p) => p.userId)],
    weekStart,
  );
  return points
    .map((p) => ({
      ...p,
      name: p.userId === userId ? "You" : (names.get(p.userId) ?? "Player"),
    }))
    .sort((a, b) => b.points - a.points);
}

function Friends({
  userId,
  friends,
}: {
  userId: string;
  friends: FriendPoints | null;
}) {
  if (friends === null)
    return (
      <p className="text-ink-muted">
        <Link href="/profile#friends" className="underline">
          Follow people on Profile
        </Link>{" "}
        to see them here.
      </p>
    );
  if (friends.length === 0)
    return <p className="text-ink-muted">No league points this week yet.</p>;
  return (
    <Table head={null}>
      {friends.map((p) => (
        <Row
          key={p.userId}
          rank={1 + friends.filter((o) => o.points > p.points).length}
          name={p.name}
          week={null}
          points={p.points}
          mine={p.userId === userId}
          promoted={false}
        />
      ))}
    </Table>
  );
}

// Top down, as the design lists them: the player's tier and the next marked; tiers
// above theirs are outlined, theirs and those below filled.
function Tiers({ tier }: { tier: LeagueTier }) {
  const at = TIERS.indexOf(tier);
  return (
    <ul className="flex flex-col gap-[9px] text-sm">
      {[...TIERS].reverse().map((t) => {
        const i = TIERS.indexOf(t);
        return (
          <li
            key={t}
            className={`flex items-center gap-2.5 ${i === at ? "font-bold" : i > at ? "text-ink-muted" : "text-ink-soft"}`}
          >
            <TierMark tier={t} reached={i <= at} />
            {TIER_NAMES[t]}
            {i === at ? " · you" : i === at + 1 ? " · next" : ""}
          </li>
        );
      })}
    </ul>
  );
}
