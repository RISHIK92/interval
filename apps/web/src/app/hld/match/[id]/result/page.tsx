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
import {
  outcome,
  ResultHero,
} from "../../../../play/battle/[id]/result/ResultHero";
import { Waiting } from "./Waiting";
import { BATTLE_MODE_NAMES } from "../../../../battle-mode";

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
  const levelsOf = (judgementId: string | null) => {
    const j = judgementId === null ? undefined : byId.get(judgementId);
    return j?.ownerLevels ?? j?.levels ?? null;
  };
  const rubricOf = (s: (typeof seats)[number]) => {
    const levels = levelsOf(s.judgementId);
    return match.rubricIncluded === true &&
      s.baselinePassed === true &&
      levels !== null
      ? rubricPoints(problem.rubric, levels)
      : null;
  };
  const me = seats.find((s) => s.userId === actor.userId);
  const others = seats.filter((s) => s.userId !== actor.userId);
  const asPlayer = (s: (typeof seats)[number]) => ({
    place: s.place,
    total: s.total,
    name: s.player,
  });
  const meta = `${match.unrated ? "Unrated" : "Rated"} · ${BATTLE_MODE_NAMES[match.battleMode]}`;
  // The viewer's own points, as the design's score breakdown (wide screens).
  const breakdown =
    me === undefined || match.scoredAt === null
      ? []
      : [
          { label: "Simulation", got: me.simulationPoints, of: 60 },
          ...(match.rubricIncluded === true
            ? [{ label: "Rubric (AI)", got: rubricOf(me), of: RUBRIC_POINTS }]
            : []),
          { label: "Speed", got: me.speedPoints, of: 15 },
        ];
  const TH = "lg:py-2 lg:font-medium";
  const TD = "lg:border-t lg:border-hairline lg:py-2";
  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-6 px-4 pt-6 pb-12 lg:max-w-[75rem] lg:gap-5 lg:px-7 lg:pt-3">
      <ResultHero
        kind="HLD battle"
        problem={problem.title}
        headline={
          match.scoredAt === null
            ? "Scoring"
            : outcome(
                me === undefined ? undefined : asPlayer(me),
                others.map(asPlayer),
              )
        }
        detail={[
          others.length === 0
            ? "Solo"
            : `against ${others.map((o) => o.player).join(", ")}`,
          meta,
        ].join(" · ")}
        change={changes.get(actor.userId) ?? null}
      />
      <header className="lg:hidden">
        <h1 className="text-display">{problem.title}: results</h1>
        <p className="text-sm text-ink-muted">
          {meta} ·{" "}
          <Link href="/hld/play" className="underline">
            Play again
          </Link>{" "}
          ·{" "}
          <Link href={`/hld/match/${id.data}/replay`} className="underline">
            Replay
          </Link>
        </p>
      </header>
      <div className="flex flex-col gap-6 lg:grid lg:grid-cols-2 lg:items-start lg:gap-5">
        <div className="flex min-w-0 flex-col gap-6 lg:gap-3.5 lg:rounded-[22px] lg:border lg:border-hairline lg:px-[22px] lg:py-5">
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
              {breakdown.length === 0 ? null : (
                <section
                  aria-label="Your score"
                  className="hidden flex-col gap-3.5 lg:flex"
                >
                  <h2 className="text-section tracking-[-0.01em]">
                    Score breakdown
                  </h2>
                  {breakdown.map((b) => (
                    <div key={b.label}>
                      <p className="mb-1.5 flex justify-between text-sm">
                        <span>{b.label}</span>
                        <span className="font-bold tabular-nums">
                          {b.got ?? "–"} / {b.of}
                        </span>
                      </p>
                      <div className="h-2 rounded bg-track">
                        <div
                          className="h-2 rounded bg-go"
                          style={{
                            width: `${String(Math.min(100, ((b.got ?? 0) / b.of) * 100))}%`,
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </section>
              )}
              <table className="w-full text-sm tabular-nums">
                <thead>
                  <tr className="text-left lg:text-[13px] lg:text-ink-muted">
                    <th className={TH}>Place</th>
                    <th className={TH}>Player</th>
                    <th className={TH}>Simulation /60</th>
                    <th className={TH}>Rubric /{RUBRIC_POINTS}</th>
                    <th className={TH}>Speed /15</th>
                    <th className={TH}>Total</th>
                    <th className={TH}>Rating</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((s) => {
                    const change = changes.get(s.userId);
                    return (
                      <tr
                        key={s.userId}
                        className={
                          s.userId === actor.userId
                            ? "lg:font-semibold"
                            : undefined
                        }
                      >
                        <td className={TD}>{s.place}</td>
                        <td className={TD}>
                          {s.player}
                          {s.autoSubmitted ? " (at the deadline)" : ""}
                        </td>
                        <td className={TD}>{s.simulationPoints}</td>
                        <td className={TD}>{rubricOf(s) ?? "–"}</td>
                        <td className={TD}>{s.speedPoints}</td>
                        <td className={`font-semibold ${TD}`}>{s.total}</td>
                        <td className={TD}>
                          {change === undefined
                            ? "–"
                            : `${change >= 0 ? "+" : ""}${change.toFixed(1)}`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {match.rubricIncluded === true ? (
                <section>
                  <h2 className="text-title lg:text-section lg:tracking-normal">
                    The rubric{" "}
                    <span className="text-xs text-ink-muted">AI</span>
                  </h2>
                  <table className="w-full text-sm tabular-nums">
                    <thead>
                      <tr className="text-left lg:text-[13px] lg:text-ink-muted">
                        <th className={TH}>Player</th>
                        {problem.rubric.map((c) => (
                          <th key={c.id} title={c.criterion} className={TH}>
                            {c.id} /4
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((s) => {
                        const levels = levelsOf(s.judgementId);
                        return (
                          <tr key={s.userId}>
                            <td className={TD}>{s.player}</td>
                            {problem.rubric.map((c) => (
                              <td key={c.id} className={TD}>
                                {levels?.[c.id]?.level ?? "–"}
                              </td>
                            ))}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <ul className="mt-1 text-xs text-ink-muted lg:mt-2">
                    {problem.rubric.map((c) => (
                      <li key={c.id}>
                        {c.id}: {c.criterion}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </>
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-6 lg:gap-3">
          <Feedback
            ask={null}
            initial={mine === null ? null : feedbackView(mine)}
          />
          <div className="hidden flex-wrap gap-2 lg:mt-1.5 lg:flex">
            <Link
              href={`/hld/match/${id.data}/replay`}
              className="flex h-[46px] items-center gap-2 rounded-full bg-ink px-5 font-semibold text-page"
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                className="size-[13px]"
              >
                <path d="M7 4.5v15l12-7.5z" fill="currentColor" />
              </svg>
              Watch replay
            </Link>
            <Link
              href="/hld/play"
              className="flex h-[46px] items-center rounded-full border-[1.5px] border-track px-5 font-semibold"
            >
              Play again
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
