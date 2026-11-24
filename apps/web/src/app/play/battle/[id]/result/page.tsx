import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { battleResults, sessionReader } from "../../../../../server/container";
import Link from "next/link";
import { AutoRefresh } from "./AutoRefresh";
import { ResultActions } from "./ResultActions";
import { Replay } from "./Replay";
import { Points } from "./Points";
import { outcome, ResultHero } from "./ResultHero";
import { BATTLE_MODE_NAMES } from "../../../../battle-mode";

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
  const battleMode = BATTLE_MODE_NAMES[result.battleMode];
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
          battleMode,
        ].join(" · ")}
        change={result.change}
      />
      <header className="lg:hidden">
        <h1 className="text-display">Battle results</h1>
        <p className="mt-1 text-ink-muted">
          {result.problem} · {battleMode}
          {result.finishedAt === null ? " · still on" : ""}
        </p>
      </header>
      <div className="flex flex-col gap-6 lg:grid lg:grid-cols-2 lg:items-start lg:gap-5">
        <div className="flex min-w-0 flex-col gap-6 lg:gap-5 lg:rounded-[22px] lg:border lg:border-hairline lg:px-[22px] lg:py-5">
          {result.finishedAt === null ? (
            <section
              role="status"
              aria-label="Still on"
              className="flex flex-col gap-2 rounded-2xl bg-well px-5 py-4"
            >
              <AutoRefresh everyMs={REFRESH_MS} />
              <p className="flex items-center gap-2.5 text-section">
                <span
                  aria-hidden="true"
                  className="size-2 rounded-full bg-live motion-safe:animate-pulse"
                />
                This battle is still on
              </p>
              <p className="text-sm text-ink-muted">
                The standings below are as they are now. The final results,
                rating change and replay show here by themselves once it ends.
              </p>
            </section>
          ) : null}
          <section aria-label="Standings" className="flex flex-col gap-2">
            <h2 className="hidden text-section tracking-[-0.01em] lg:block">
              Standings
            </h2>
            <div className="-mx-4 overflow-x-auto px-4 lg:mx-0 lg:px-0">
              <table className="w-full text-sm tabular-nums">
                <thead>
                  <tr className="text-left text-[13px] text-ink-muted">
                    <th className={TH}>Place</th>
                    <th className={TH}>Player</th>
                    <th className={TH}>Points</th>
                    <th className={TH}>Best at</th>
                  </tr>
                </thead>
                <tbody>
                  {result.standings.map((s) => (
                    <tr
                      key={s.userId}
                      aria-current={s.you ? "true" : undefined}
                      className={s.you ? "bg-well font-semibold" : undefined}
                    >
                      <td
                        className={`${TD} pl-2 ${s.you ? "rounded-l-lg" : ""}`}
                      >
                        {s.place === null ? "–" : ordinal(s.place)}
                      </td>
                      <td className={TD}>
                        {names[s.userId]}
                        {s.abandoned ? (
                          <span className="ml-1.5 text-xs font-normal text-ink-muted">
                            abandoned
                          </span>
                        ) : null}
                      </td>
                      <td className={`${TD} font-bold`}>
                        <Points total={s.total} hintCost={s.hintCost} />
                      </td>
                      <td className={`${TD} ${s.you ? "rounded-r-lg" : ""}`}>
                        {clock(s.timeMs)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
          <div className="hidden flex-wrap gap-2 lg:mt-1.5 lg:flex">
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

const REFRESH_MS = 10_000;
const TH = "whitespace-nowrap py-2 pr-3 font-medium last:pr-0";
const TD = "border-t border-hairline py-2 pr-3 last:pr-0";
const ORDINALS = ["1st", "2nd", "3rd", "4th"];
const ordinal = (place: number) => ORDINALS[place - 1] ?? String(place);
