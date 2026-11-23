import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { battleResults, sessionReader } from "../../../../../server/container";
import Link from "next/link";
import { ResultActions } from "./ResultActions";
import { Replay } from "./Replay";
import { outcome, ResultHero } from "./ResultHero";

export const dynamic = "force-dynamic";

// P5-W35 (§6.5, DB-6; Q-P5-14, Q-P5-22): a battle's results, for its players: where
// everyone placed, the viewer's rating change, every player's code over time once it's
// over, the AI code review of their best submission, and a dispute.
const Id = z.uuid();

function clock(ms: number | null): string {
  if (ms === null) return "–";
  const s = Math.round(ms / 1000);
  return `${String(Math.floor(s / 60))}:${String(s % 60).padStart(2, "0")}`;
}

export default async function BattleResultPage(props: {
  params: Promise<{ id: string }>;
}) {
  const actor = await sessionReader().current(await headers());
  if (actor === null) redirect("/play");
  const id = Id.safeParse((await props.params).id);
  if (!id.success) notFound();
  const result = await battleResults().of(id.data, actor.userId);
  if (result === null) notFound();
  const frames =
    result.finishedAt === null
      ? []
      : ((await battleResults().frames(id.data, actor.userId)) ?? []);
  const names = Object.fromEntries(
    result.standings.map((s) => [s.userId, s.you ? "You" : s.name]),
  );
  const me = result.standings.find((s) => s.you);
  const others = result.standings.filter((s) => !s.you);
  const league = result.league === "ai" ? "AI league" : "Human league";
  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-6 px-4 pt-6 pb-12 lg:max-w-[75rem] lg:gap-5 lg:px-7 lg:pt-3">
      <ResultHero
        kind="LLD battle"
        problem={result.problem}
        headline={result.finishedAt === null ? "Still on" : outcome(me, others)}
        detail={[
          others.length === 0
            ? "Solo"
            : `against ${others.map((o) => o.name).join(", ")}`,
          league,
        ].join(" · ")}
        change={result.change}
      />
      <header className="lg:hidden">
        <h1 className="text-display">Battle results</h1>
        <p className="mt-1 text-ink-muted">
          {result.problem} · {league}
          {result.finishedAt === null ? " · still on" : ""}
        </p>
      </header>
      <div className="flex flex-col gap-6 lg:grid lg:grid-cols-2 lg:items-start lg:gap-5">
        <div className="flex min-w-0 flex-col gap-6 lg:gap-3.5 lg:rounded-[22px] lg:border lg:border-hairline lg:px-[22px] lg:py-5">
          <section aria-label="Standings">
            <h2 className="mb-2 hidden text-section lg:block">Standings</h2>
            <table className="w-full text-sm tabular-nums">
              <thead>
                <tr className="text-left lg:text-[13px] lg:text-ink-muted">
                  <th className="lg:py-2 lg:font-medium">Place</th>
                  <th className="lg:py-2 lg:font-medium">Player</th>
                  <th className="lg:py-2 lg:font-medium">Points</th>
                  <th className="lg:py-2 lg:font-medium">Best at</th>
                </tr>
              </thead>
              <tbody>
                {result.standings.map((s) => (
                  <tr
                    key={s.userId}
                    className={`lg:border-t lg:border-hairline ${s.you ? "font-semibold" : ""}`}
                  >
                    <td className="lg:py-2">{s.place ?? "–"}</td>
                    <td className="lg:py-2">
                      {names[s.userId]}
                      {s.abandoned ? " (abandoned)" : ""}
                    </td>
                    <td className="lg:py-2 lg:font-bold">{s.total}</td>
                    <td className="lg:py-2">{clock(s.timeMs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {result.change !== null && (
              <p className="mt-2 text-sm lg:hidden">
                Your rating: {result.change >= 0 ? "+" : ""}
                {result.change.toFixed(1)}
              </p>
            )}
          </section>
          {frames.length > 0 && (
            <Replay
              matchId={id.data}
              frames={frames.map((f) => ({
                name: names[f.userId] ?? f.userId,
                takenAt: f.takenAt.toISOString(),
              }))}
            />
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-6 lg:gap-3">
          {result.finishedAt !== null && (
            <ResultActions
              matchId={id.data}
              hasBest={result.hasBest}
              review={result.review}
              disputed={result.disputed}
              disputeOpen={result.disputeOpen}
            />
          )}
          <div className="hidden gap-2 lg:mt-1.5 lg:flex">
            <Link
              href="/play/battle"
              className="flex h-[46px] items-center rounded-full bg-ink px-5 font-semibold text-page"
            >
              Battle again
            </Link>
            <Link
              href="/play"
              className="flex h-[46px] items-center rounded-full px-3.5 font-semibold text-ink-muted"
            >
              Back to Play
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
