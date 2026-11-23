import type { ReactNode } from "react";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  GAME_LABELS,
  PERIOD_LABELS,
  type Pinned,
  readBoard,
  type Row,
  SCOPE_LABELS,
  type Scope,
} from "../../../server/board-view";
import { type Game, GAMES, type Period, PERIODS } from "../../../server/boards";
import { preferences, sessionReader } from "../../../server/container";
import { Card } from "../../ui/Card";
import { INNER_PAGE_TITLE, Page, RailCard } from "../../ui/Page";
import { requireUsername } from "../../username/gate";

export const dynamic = "force-dynamic";

const NOT_YET = "You're not on this board yet: play to join it.";

// P3-W14-S06 (§6.7; owner, 2026-11-02; wireframe 15 `lead`): every board, the top 50 of
// the current or previous period, with the player's own row always in view
// (server/board-view.ts, shared with the app's).
export default async function BoardsPage(props: {
  searchParams: Promise<{ game?: string; scope?: string; period?: string }>;
}) {
  const actor = await sessionReader().current(await headers());
  if (actor === null) redirect("/join");
  if (!actor.isGuest) await requireUsername(actor.userId, "/play/boards");
  const [view, chosen] = await Promise.all([
    readBoard(actor, await props.searchParams, new Date()),
    preferences().get(actor.userId),
  ]);
  const { game, scope, period, scopes: allowed } = view;
  const href = (change: { game?: Game; scope?: Scope; period?: Period }) =>
    `/play/boards?${new URLSearchParams({ game, scope, period, ...change }).toString()}`;

  const shown = view.body;
  const body: ReactNode =
    shown.kind === "unset" ? (
      shown.what === "follows" ? (
        <Empty>
          <Link href="/profile#friends" className="underline">
            Follow people on Profile
          </Link>{" "}
          to see them here.
        </Empty>
      ) : (
        <Empty>
          <Link href="/profile" className="underline">
            Set your {shown.what} on Profile
          </Link>{" "}
          to see its board.
        </Empty>
      )
    ) : (
      <Table
        rows={shown.rows}
        mine={shown.mine}
        mark={shown.mark}
        unit={shown.unit}
        pinned={shown.pinned}
        missing={
          shown.missing === null ? null : shown.missing === "set_university" ? (
            <>
              <Link href="/profile" className="underline">
                Set your university on Profile
              </Link>{" "}
              to see where it stands.
            </>
          ) : shown.missing === "university_absent" ? (
            "Your university isn't on this board yet: its players haven't played."
          ) : (
            NOT_YET
          )
        }
      />
    );

  // Wide screens: Play's sidebar and the design's rail (Leagues, web), with what the
  // boards really do; tiers and promotion zones aren't built.
  return (
    <Page
      phoneTabBar={false}
      tab="play"
      firstName={chosen?.firstName ?? null}
      railLabel="About the boards"
      rail={
        <>
          <RailCard className="flex flex-col gap-2">
            <span className="text-section">How boards work</span>
            <span className="text-sm leading-normal text-ink-soft">
              The top 50 of {PERIOD_LABELS[game][period].toLowerCase()}, with
              your own row always in view. Tied players share a rank.
            </span>
          </RailCard>
          <RailCard href="/play/boards/battles" className="flex flex-col gap-1">
            <span className="text-[13px] text-ink-muted">This season</span>
            <span className="text-[15px] leading-tight font-semibold">
              Battle boards
            </span>
          </RailCard>
        </>
      }
      className="flex flex-col gap-5 lg:gap-[18px]"
    >
      {/* The sidebar's Play does this on wide screens. */}
      <Link href="/play" className="text-sm text-ink-muted underline lg:hidden">
        Back to Play
      </Link>
      {/* Wide screens: the design's league head (Leagues, web), on the board shown. */}
      <div className="flex items-center gap-4">
        <span
          aria-hidden="true"
          className="hidden size-16 shrink-0 items-center justify-center rounded-[18px] bg-(--distributed-systems-tint) lg:flex"
        >
          <svg viewBox="0 0 44 44" className="size-11">
            <path d="M12 6h20l8 11H4z" fill="var(--distributed-systems-top)" />
            <path d="M4 17h18v22z" fill="var(--distributed-systems-left)" />
            <path
              d="M22 17h18L22 39z"
              fill="var(--distributed-systems-right)"
            />
          </svg>
        </span>
        <div>
          <h1 className={INNER_PAGE_TITLE}>Boards</h1>
          <p className="mt-0.5 hidden text-sm text-ink-muted lg:block">
            {GAME_LABELS[game]} · {SCOPE_LABELS[scope]} ·{" "}
            <span className="font-semibold text-ink">
              {PERIOD_LABELS[game][period]}
            </span>
          </p>
        </div>
      </div>
      {/* Wireframe 15: the filters are chips in one row. */}
      <nav
        aria-label="Filters"
        className="flex items-center gap-2 overflow-x-auto pb-1 lg:flex-wrap lg:gap-3 lg:overflow-visible"
      >
        <Chips label="Game">
          {GAMES.map((g) => (
            <Chip key={g} href={href({ game: g })} on={g === game}>
              {GAME_LABELS[g]}
            </Chip>
          ))}
        </Chips>
        <Chips label="Board">
          {allowed.map((s) => (
            <Chip key={s} href={href({ scope: s })} on={s === scope}>
              {SCOPE_LABELS[s]}
            </Chip>
          ))}
        </Chips>
        <Chips label="When">
          {PERIODS.map((p) => (
            <Chip key={p} href={href({ period: p })} on={p === period}>
              {PERIOD_LABELS[game][p]}
            </Chip>
          ))}
        </Chips>
      </nav>
      <Card className="p-4 lg:overflow-hidden lg:rounded-[20px] lg:p-0">
        {body}
      </Card>
    </Page>
  );
}

function Chips({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div
      role="group"
      aria-label={label}
      className="flex shrink-0 gap-2 border-r border-hairline pr-2 last:border-r-0 last:pr-0 lg:h-11 lg:gap-1 lg:rounded-[14px] lg:border-r-0 lg:bg-well lg:p-1 lg:pr-1"
    >
      {children}
    </div>
  );
}

function Chip({
  href,
  on,
  children,
}: {
  href: string;
  on: boolean;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={on ? "page" : undefined}
      className={`shrink-0 rounded-full border px-3 py-1.5 text-sm font-semibold lg:flex lg:items-center lg:rounded-[10px] lg:border-0 lg:px-3.5 lg:py-0 ${on ? "border-ink bg-ink text-page lg:bg-lift lg:text-ink lg:shadow-[0_1px_3px_rgba(16,18,23,0.14)]" : "border-hairline bg-page text-ink lg:bg-transparent lg:font-medium lg:text-ink-muted"}`}
    >
      {children}
    </Link>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="text-ink-muted lg:px-[18px] lg:py-4">{children}</p>;
}

// The player's own row is pinned under the list and stays in view as it scrolls
// (wireframe 15), with its rank and percentile; it is also marked in the list.
function Table({
  rows,
  mine,
  mark,
  unit,
  pinned,
  missing,
}: {
  rows: Row[];
  mine: string | null;
  mark: string;
  unit: string;
  pinned: Pinned | null;
  missing: ReactNode;
}) {
  return (
    <>
      <p className="mb-2 text-sm text-ink-muted lg:mb-0 lg:flex lg:border-b lg:border-hairline lg:px-[18px] lg:py-3 lg:text-[13px]">
        <span className="hidden w-16 lg:inline">Rank</span>
        <span className="hidden flex-1 lg:inline">Player</span>
        {unit}
      </p>
      {rows.length === 0 ? (
        <Empty>Nobody on this board yet.</Empty>
      ) : (
        // Not <ol>: tied players share a rank, which the list's own numbers wouldn't.
        <ul className="flex flex-col lg:py-1">
          {rows.map((row) => (
            <li
              key={row.id}
              aria-current={row.id === mine ? "true" : undefined}
              className={`flex items-center gap-3 rounded-xl px-3 py-2 lg:gap-0 lg:rounded-none lg:px-[18px] lg:py-2.5 lg:text-[15px] ${row.id === mine ? "bg-well font-semibold lg:bg-ink lg:py-[13px] lg:font-bold lg:text-page" : "lg:font-semibold"}`}
            >
              <span
                className={`w-10 text-numbers lg:w-16 lg:text-[15px] ${row.id === mine ? "text-ink-muted lg:text-page" : "text-ink-muted"}`}
              >
                #{row.rank}
              </span>
              <span className="flex-1 truncate">
                {row.name}
                {row.id === mine ? (
                  <span className="ml-2 text-sm text-go-text lg:text-go">
                    {mark}
                  </span>
                ) : null}
              </span>
              <span className="text-numbers lg:text-[15px]">{row.score}</span>
            </li>
          ))}
        </ul>
      )}
      {pinned !== null ? (
        <p className="sticky bottom-4 mt-3 flex items-center gap-3 rounded-xl border border-hairline bg-well px-3 py-2 font-semibold shadow-card lg:m-3 lg:px-[18px] lg:py-3">
          <span className="flex-1 truncate">
            {pinned.name} <span className="text-sm text-go-text">{mark}</span>
          </span>
          <span className="text-numbers lg:text-[15px]">{pinned.note}</span>
          <span className="text-numbers lg:text-[15px]">{pinned.score}</span>
        </p>
      ) : missing === null ? null : (
        <p className="mt-3 text-ink-muted lg:m-0 lg:border-t lg:border-hairline lg:px-[18px] lg:py-3 lg:text-sm">
          {missing}
        </p>
      )}
    </>
  );
}
