import { headers } from "next/headers";
import { INNER_PAGE_TITLE, Page } from "../../../ui/Page";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  battleBoards,
  preferences,
  sessionReader,
} from "../../../../server/container";
import type { BattleMode } from "../../../../server/ports";

export const dynamic = "force-dynamic";

// P5-W33 (§6.7, Q-P5-20): this season's battle boards, global, a pair per battle mode: the
// 1v1 rating and the room rating. A season is a calendar month (UTC), as quick games'.
const BOARDS: {
  battleMode: BattleMode;
  kind: "duel" | "room";
  title: string;
}[] = [
  { battleMode: "human", kind: "duel", title: "Human mode, 1v1" },
  { battleMode: "human", kind: "room", title: "Human mode, rooms" },
  { battleMode: "ai", kind: "duel", title: "AI mode, 1v1" },
  { battleMode: "ai", kind: "room", title: "AI mode, rooms" },
];

export default async function BattleBoardsPage() {
  const actor = await sessionReader().current(await headers());
  if (actor === null) redirect("/join");
  const now = new Date();
  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const [boards, chosen] = await Promise.all([
    Promise.all(
      BOARDS.map((b) =>
        battleBoards().top(b.battleMode, b.kind, since, actor.userId, 50),
      ),
    ),
    preferences().get(actor.userId),
  ]);
  // Wide screens: Play's sidebar, and each board as the design's league table (Leagues,
  // web): rank, player and rating, the player's own row in ink.
  return (
    <Page
      phoneTabBar={false}
      tab="play"
      firstName={chosen?.firstName ?? null}
      className="flex flex-col gap-6 lg:gap-[18px]"
    >
      <header>
        <h1 className={INNER_PAGE_TITLE}>Battle boards</h1>
        <p className="mt-1 text-ink-muted lg:mt-0.5 lg:text-sm">
          This season, everyone rated in it.{" "}
          <Link
            href="/play/boards"
            className="underline lg:font-semibold lg:text-ink"
          >
            Quick-game boards
          </Link>
        </p>
      </header>
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-1 lg:gap-3.5 xl:grid-cols-2">
        {BOARDS.map((b, i) => (
          <section
            key={`${b.battleMode}-${b.kind}`}
            aria-label={b.title}
            className="lg:overflow-hidden lg:rounded-[20px] lg:border lg:border-hairline lg:bg-card lg:shadow-card"
          >
            <h2 className="text-title lg:flex lg:items-baseline lg:justify-between lg:border-b lg:border-hairline lg:px-[18px] lg:py-3 lg:text-section">
              {b.title}
              <span className="hidden text-[13px] font-medium text-ink-muted lg:inline">
                Rating
              </span>
            </h2>
            {(boards[i] ?? []).length === 0 ? (
              <p className="text-sm text-ink-muted lg:px-[18px] lg:py-4">
                Nobody yet this season.
              </p>
            ) : (
              <ol className="mt-2 flex flex-col gap-1 text-sm tabular-nums lg:mt-0 lg:gap-0 lg:py-1 lg:text-[15px]">
                {(boards[i] ?? []).map((row, n) => (
                  <li
                    key={`${row.name}-${String(n)}`}
                    className={`lg:flex lg:items-center lg:px-[18px] ${row.you ? "font-semibold lg:bg-ink lg:py-[13px] lg:font-bold lg:text-page" : "lg:py-2.5 lg:font-semibold"}`}
                  >
                    <span
                      className={`lg:w-16 lg:font-bold ${row.you ? "" : "lg:text-ink-muted"}`}
                    >
                      {n + 1}.
                    </span>{" "}
                    <span className="lg:flex-1 lg:truncate">
                      {row.name}
                      {row.you ? " (you)" : ""}
                    </span>
                    <span className="lg:hidden">: </span>
                    <span className="lg:font-bold">
                      {Math.round(row.rating)}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        ))}
      </div>
    </Page>
  );
}
