import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { battleBoards, sessionReader } from "../../../../server/container";
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
  const boards = await Promise.all(
    BOARDS.map((b) =>
      battleBoards().top(b.battleMode, b.kind, since, actor.userId, 50),
    ),
  );
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 pt-6 pb-12 lg:max-w-[60rem] lg:gap-[18px] lg:px-8 lg:pt-7">
      <header>
        <h1 className="text-display lg:text-[32px] lg:tracking-[-0.03em]">
          Battle boards
        </h1>
        <p className="mt-1 text-ink-muted">
          This season, everyone rated in it.{" "}
          <Link href="/play/boards" className="underline">
            Quick-game boards
          </Link>
        </p>
      </header>
      <div className="grid gap-6 sm:grid-cols-2 lg:gap-3.5">
        {BOARDS.map((b, i) => (
          <section
            key={`${b.battleMode}-${b.kind}`}
            aria-label={b.title}
            className="lg:rounded-[20px] lg:border lg:border-hairline lg:bg-page lg:p-[18px] lg:shadow-card"
          >
            <h2 className="text-title lg:text-section">{b.title}</h2>
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
