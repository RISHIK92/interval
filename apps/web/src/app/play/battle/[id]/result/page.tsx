import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { battleResults, sessionReader } from "../../../../../server/container";
import { ResultActions } from "./ResultActions";
import { Replay } from "./Replay";

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
  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-6 px-4 pt-6 pb-12">
      <header>
        <h1 className="text-display">Battle results</h1>
        <p className="mt-1 text-ink-muted">
          {result.problem} ·{" "}
          {result.league === "ai" ? "AI league" : "Human league"}
          {result.finishedAt === null ? " · still on" : ""}
        </p>
      </header>
      <section aria-label="Standings">
        <table className="w-full text-sm tabular-nums">
          <thead>
            <tr className="text-left">
              <th>Place</th>
              <th>Player</th>
              <th>Points</th>
              <th>Best at</th>
            </tr>
          </thead>
          <tbody>
            {result.standings.map((s) => (
              <tr
                key={s.userId}
                className={s.you ? "font-semibold" : undefined}
              >
                <td>{s.place ?? "–"}</td>
                <td>
                  {names[s.userId]}
                  {s.abandoned ? " (abandoned)" : ""}
                </td>
                <td>{s.total}</td>
                <td>{clock(s.timeMs)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {result.change !== null && (
          <p className="mt-2 text-sm">
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
      {result.finishedAt !== null && (
        <ResultActions
          matchId={id.data}
          hasBest={result.hasBest}
          review={result.review}
          disputed={result.disputed}
          disputeOpen={result.disputeOpen}
        />
      )}
    </main>
  );
}
