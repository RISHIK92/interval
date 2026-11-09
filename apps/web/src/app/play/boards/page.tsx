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
import { sessionReader } from "../../../server/container";
import { Card } from "../../ui/Card";
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
  const view = await readBoard(actor, await props.searchParams, new Date());
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

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-5 px-4 pt-6 pb-24 lg:max-w-[52rem] lg:pt-10">
      <Link href="/play" className="text-sm text-ink-muted underline">
        Back to Play
      </Link>
      <h1 className="text-display">Boards</h1>
      {/* Wireframe 15: the filters are chips in one row. */}
      <nav
        aria-label="Filters"
        className="flex items-center gap-2 overflow-x-auto pb-1"
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
      <Card className="p-4">{body}</Card>
    </main>
  );
}

function Chips({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div
      role="group"
      aria-label={label}
      className="flex shrink-0 gap-2 border-r border-hairline pr-2 last:border-r-0 last:pr-0"
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
      className={`shrink-0 rounded-full border px-3 py-1.5 text-sm font-semibold ${on ? "border-ink bg-ink text-page" : "border-hairline bg-page text-ink"}`}
    >
      {children}
    </Link>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="text-ink-muted">{children}</p>;
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
      <p className="mb-2 text-sm text-ink-muted">{unit}</p>
      {rows.length === 0 ? (
        <Empty>Nobody on this board yet.</Empty>
      ) : (
        // Not <ol>: tied players share a rank, which the list's own numbers wouldn't.
        <ul className="flex flex-col">
          {rows.map((row) => (
            <li
              key={row.id}
              aria-current={row.id === mine ? "true" : undefined}
              className={`flex items-center gap-3 rounded-xl px-3 py-2 ${row.id === mine ? "bg-well font-semibold" : ""}`}
            >
              <span className="w-10 text-numbers text-ink-muted">
                #{row.rank}
              </span>
              <span className="flex-1 truncate">
                {row.name}
                {row.id === mine ? (
                  <span className="ml-2 text-sm text-go-text">{mark}</span>
                ) : null}
              </span>
              <span className="text-numbers">{row.score}</span>
            </li>
          ))}
        </ul>
      )}
      {pinned !== null ? (
        <p className="sticky bottom-4 mt-3 flex items-center gap-3 rounded-xl border border-hairline bg-well px-3 py-2 font-semibold shadow-card">
          <span className="flex-1 truncate">
            {pinned.name} <span className="text-sm text-go-text">{mark}</span>
          </span>
          <span className="text-numbers">{pinned.note}</span>
          <span className="text-numbers">{pinned.score}</span>
        </p>
      ) : missing === null ? null : (
        <p className="mt-3 text-ink-muted">{missing}</p>
      )}
    </>
  );
}
