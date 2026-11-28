import { Design, starterDesign } from "@interval/hld";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import {
  entitlements,
  hldDeps,
  hldMatches,
  sessionReader,
} from "../../../../server/container";
import { advance, problemOf } from "../../../../server/hld-matches";
import { matchProgress } from "../../../../server/hld-match-requests";
import { log } from "../../../../server/log";
import { Canvas } from "../../Canvas";
import { Clock } from "../../Clock";
import { Cube } from "../../flow";
import { LeaveMatch } from "../../MatchPanel";
import { CANVAS_FRAME, HEADER_TILE, TITLE } from "../../Frame";
import { BATTLE_MODE_NAMES } from "../../../battle-mode";
import { OpponentProgress } from "./OpponentProgress";

export const dynamic = "force-dynamic";

// P6-W42 (§6.4, CANVAS-1, Q-P6-06): a match, for its players: the problem, the canvas
// from the player's last autosave (or, once submitted, the submission), the clock and the
// submission. Over, it's the results.
export default async function HldMatchPage({
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
  const seat = found?.seats.find((s) => s.userId === actor.userId);
  if (found === null || seat === undefined) notFound();
  if (found.match.closedAt !== null) redirect(`/hld/match/${id.data}/result`);
  const problem = problemOf(found.match);
  const latest = await hldMatches().latestVersion(id.data, actor.userId);
  const parsed = Design.safeParse(latest?.design);
  // ADR-0060: a submission's verdicts show once it's in. `record` wrote it from a
  // Design, so one that doesn't parse is a fault: logged (LOAD-5; the AWS stack counts
  // this line as a metric), and the page still says submitted, with no verdicts.
  const stored =
    seat.submittedAt === null ? null : Design.safeParse(seat.design);
  if (stored?.success === false)
    log.warn("hld: submitted design unreadable", {
      matchId: id.data,
      userId: actor.userId,
    });
  const submission = stored?.success === true ? stored.data : null;
  const players = found.seats.length;
  // Q-WD-14: the opponents' progress from the first paint, so the header doesn't shift.
  const progress = await matchProgress(actor.userId, id.data);
  if (progress === "closed") redirect(`/hld/match/${id.data}/result`);
  if (progress === "not_player") notFound();
  return (
    <main className={CANVAS_FRAME}>
      <Canvas
        header={
          <>
            <LeaveMatch />
            <span className={HEADER_TILE}>
              <Cube size={30} ramp="system-design" />
            </span>
            <div className="lg:min-w-[200px] lg:flex-1">
              <p className="hidden text-[13px] text-ink-muted lg:block">
                HLD battle ·{" "}
                {players === 1
                  ? "solo"
                  : players === 2
                    ? "1v1"
                    : `${String(players)} players`}
              </p>
              <h1 className={TITLE}>{problem.title}</h1>
              <p className="text-sm text-ink-muted lg:hidden">
                {found.seats.map((s) => s.player).join(" vs ")}
                {found.match.unrated ? " · unrated" : ""} ·{" "}
                {BATTLE_MODE_NAMES[found.match.battleMode]}
              </p>
            </div>
            <span className="hidden h-[38px] items-center rounded-full bg-well px-3 text-sm text-ink-muted lg:flex">
              {found.seats.map((s) => s.player).join(" vs ")}
              {found.match.unrated ? " · unrated" : ""} ·{" "}
              {BATTLE_MODE_NAMES[found.match.battleMode]}
            </span>
            <OpponentProgress matchId={id.data} initial={progress} />
            <Clock deadline={found.match.deadlineAt.toISOString()} />
          </>
        }
        problem={problem}
        initial={
          submission ??
          (parsed.success ? parsed.data : starterDesign(problem.spec))
        }
        version={latest?.version ?? 0}
        mode={{
          kind: "match",
          matchId: id.data,
          deadline: found.match.deadlineAt.toISOString(),
          submitted: seat.submittedAt !== null,
          submission,
        }}
      />
    </main>
  );
}
