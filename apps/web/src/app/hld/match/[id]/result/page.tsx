import { RUBRIC_POINTS, rubricPoints } from "@interval/hld";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import {
  entitlements,
  hldDeps,
  hldJudgements,
  hldMatches,
  sessionReader,
} from "../../../../../server/container";
import { advance, problemOf } from "../../../../../server/hld-matches";
import { Feedback } from "../../../Feedback";
import { feedbackView } from "../../../practice/feedback";
import { Waiting } from "./Waiting";

export const dynamic = "force-dynamic";

// P6-W42 (§6.4, Q-P6-06): a match's results, for its players: each one's simulation,
// rubric and speed points, total and place, and rating change; the player's own AI
// judgement and coaching (labelled AI, appealable). While the judge works, it waits.
export default async function HldResultPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const actor = await sessionReader().current(await headers());
  if (actor === null) redirect("/play");
  if (!(await entitlements().can(actor.userId, "play.hld"))) redirect("/play");
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  await advance(hldDeps(), id.data);
  const found = await hldMatches().get(id.data);
  if (found === null || !found.seats.some((s) => s.userId === actor.userId))
    notFound();
  const { match, seats } = found;
  if (match.closedAt === null) redirect(`/hld/match/${id.data}`);
  const problem = problemOf(match);
  const [judgements, changes] = await Promise.all([
    hldJudgements().ofMatch(id.data),
    hldMatches().ratingChanges(id.data),
  ]);
  const byId = new Map(judgements.map((j) => [j.id, j]));
  const myJudgement = seats.find((s) => s.userId === actor.userId)?.judgementId;
  const mine =
    myJudgement === null || myJudgement === undefined
      ? null
      : (byId.get(myJudgement) ?? null);
  const rows = [...seats].sort((a, b) => (a.place ?? 9) - (b.place ?? 9));
  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-6 px-4 pt-6 pb-12">
      <header>
        <h1 className="text-display">{problem.title}: results</h1>
        <p className="text-sm text-ink-muted">
          {match.unrated ? "Unrated" : "Rated"} · the {match.league} league ·{" "}
          <Link href="/hld/play" className="underline">
            Play again
          </Link>
        </p>
      </header>
      {match.scoredAt === null ? (
        <Waiting matchId={id.data} />
      ) : (
        <>
          {match.rubricIncluded === false ? (
            <p role="status" className="text-sm">
              A player&apos;s AI judgement couldn&apos;t be written, so this
              match was scored on simulation and speed alone, scaled to 100.
            </p>
          ) : null}
          <table className="w-full text-sm tabular-nums">
            <thead>
              <tr className="text-left">
                <th>Place</th>
                <th>Player</th>
                <th>Simulation /60</th>
                <th>Rubric /{RUBRIC_POINTS}</th>
                <th>Speed /15</th>
                <th>Total</th>
                <th>Rating</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => {
                const j =
                  s.judgementId === null ? undefined : byId.get(s.judgementId);
                const levels = j?.ownerLevels ?? j?.levels ?? null;
                const change = changes.get(s.userId);
                return (
                  <tr key={s.userId}>
                    <td>{s.place}</td>
                    <td>
                      {s.player}
                      {s.autoSubmitted ? " (at the deadline)" : ""}
                    </td>
                    <td>{s.simulationPoints}</td>
                    <td>
                      {match.rubricIncluded === true &&
                      s.baselinePassed === true &&
                      levels !== null
                        ? rubricPoints(problem.rubric, levels)
                        : "–"}
                    </td>
                    <td>{s.speedPoints}</td>
                    <td className="font-semibold">{s.total}</td>
                    <td>
                      {change === undefined
                        ? "–"
                        : `${change >= 0 ? "+" : ""}${change.toFixed(1)}`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}
      <Feedback
        ask={null}
        initial={mine === null ? null : feedbackView(mine)}
      />
    </main>
  );
}
