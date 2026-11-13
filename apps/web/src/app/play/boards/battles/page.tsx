import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { battleBoards, sessionReader } from "../../../../server/container";
import type { League } from "../../../../server/ports";

export const dynamic = "force-dynamic";

// P5-W33 (§6.7, Q-P5-20): this season's battle boards, global, a pair per league: the
// 1v1 rating and the room rating. A season is a calendar month (UTC), as quick games'.
const BOARDS: { league: League; kind: "duel" | "room"; title: string }[] = [
  { league: "human", kind: "duel", title: "Human league, 1v1" },
  { league: "human", kind: "room", title: "Human league, rooms" },
  { league: "ai", kind: "duel", title: "AI league, 1v1" },
  { league: "ai", kind: "room", title: "AI league, rooms" },
];

export default async function BattleBoardsPage() {
  const actor = await sessionReader().current(await headers());
  if (actor === null) redirect("/join");
  const now = new Date();
  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const boards = await Promise.all(
    BOARDS.map((b) =>
      battleBoards().top(b.league, b.kind, since, actor.userId, 50),
    ),
  );
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 pt-6 pb-12">
      <header>
        <h1 className="text-display">Battle boards</h1>
        <p className="mt-1 text-ink-muted">
          This season, everyone rated in it.{" "}
          <Link href="/play/boards" className="underline">
            Quick-game boards
          </Link>
        </p>
      </header>
      <div className="grid gap-6 sm:grid-cols-2">
        {BOARDS.map((b, i) => (
          <section key={`${b.league}-${b.kind}`} aria-label={b.title}>
            <h2 className="text-title">{b.title}</h2>
            {(boards[i] ?? []).length === 0 ? (
              <p className="text-sm text-ink-muted">Nobody yet this season.</p>
            ) : (
              <ol className="mt-2 flex flex-col gap-1 text-sm tabular-nums">
                {(boards[i] ?? []).map((row, n) => (
                  <li
                    key={`${row.name}-${String(n)}`}
                    className={row.you ? "font-semibold" : undefined}
                  >
                    {n + 1}. {row.name}
                    {row.you ? " (you)" : ""}: {Math.round(row.rating)}
                  </li>
                ))}
              </ol>
            )}
          </section>
        ))}
      </div>
    </main>
  );
}
