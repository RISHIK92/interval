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
// These are LLD battles' boards (HLD's ratings have none yet), named so.
const BOARDS: {
  battleMode: BattleMode;
  kind: "duel" | "room";
  title: string;
}[] = [
  { battleMode: "human", kind: "duel", title: "LLD · Human mode · 1v1" },
  { battleMode: "human", kind: "room", title: "LLD · Human mode · rooms" },
  { battleMode: "ai", kind: "duel", title: "LLD · AI mode · 1v1" },
  { battleMode: "ai", kind: "room", title: "LLD · AI mode · rooms" },
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
  // Each board as the design's league table (Leagues, web): rank, player and rating, the
  // player's own row in ink; a card on phones too, under Play's sidebar on wide screens.
  return (
    <Page
      phoneTabBar={false}
      tab="play"
      firstName={chosen?.firstName ?? null}
      className="flex flex-col gap-6 lg:gap-[18px]"
    >
      <header>
        {/* Phones have no tab bar here; the sidebar's Play does this on wide screens. */}
        <Link
          href="/play"
          className="mb-3 inline-flex text-[15px] font-semibold text-ink-soft lg:hidden"
        >
          ‹ Play
        </Link>
        <h1 className={INNER_PAGE_TITLE}>LLD battle boards</h1>
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
      <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
        {BOARDS.map((b, i) => (
          <section
            key={`${b.battleMode}-${b.kind}`}
            aria-label={b.title}
            className="overflow-hidden rounded-[20px] border border-hairline bg-card shadow-card"
          >
            <h2 className="flex items-baseline justify-between gap-3 border-b border-hairline px-[18px] py-3 text-section">
              {b.title}
              <span className="shrink-0 text-[13px] font-medium text-ink-muted">
                Rating
              </span>
            </h2>
            {(boards[i] ?? []).length === 0 ? (
              <p className="px-[18px] py-4 text-sm text-ink-muted">
                Nobody yet this season.
              </p>
            ) : (
              <ol className="flex flex-col py-1 text-[15px] tabular-nums">
                {(boards[i] ?? []).map((row, n) => (
                  <li
                    key={`${row.name}-${String(n)}`}
                    className={`flex items-center px-[18px] ${row.you ? "bg-ink py-[13px] font-bold text-page" : "py-2.5 font-semibold"}`}
                  >
                    <span
                      className={`w-12 font-bold lg:w-16 ${row.you ? "" : "text-ink-muted"}`}
                    >
                      {n + 1}.
                    </span>
                    <span className="min-w-0 flex-1 truncate">
                      {row.name}
                      {row.you ? " (you)" : ""}
                    </span>
                    <span className="font-bold">{Math.round(row.rating)}</span>
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
