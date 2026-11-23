import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import {
  entitlements,
  hldMatches,
  hldTournaments,
  sessionReader,
} from "../../../../../server/container";
import { problemOf } from "../../../../../server/hld-matches";
import { accessTo } from "../../../../../server/hld-watch";
import { Cube } from "../../../flow";
import {
  CloseLink,
  HEADER,
  HEADER_TILE,
  TITLE,
  VIEW_FRAME,
} from "../../../Frame";
import { Spectate } from "./Spectate";

export const dynamic = "force-dynamic";

// P6-W44 (§6.4, Q-P6-08): watching a tournament match live. Players in the same round
// can't (they share its problem); once it's over, it's the replay.
export default async function WatchPage(props: {
  params: Promise<{ id: string }>;
}) {
  const actor = await sessionReader().current(await headers());
  if (actor === null) redirect("/play");
  if (!(await entitlements().can(actor.userId, "play.hld"))) redirect("/play");
  const id = z.uuid().safeParse((await props.params).id);
  if (!id.success) notFound();
  const deps = { matches: hldMatches(), tournaments: hldTournaments() };
  const access = await accessTo(deps, id.data, actor.userId);
  if (access === "replay") redirect(`/hld/match/${id.data}/replay`);
  if (access === null) notFound();
  const found = await deps.matches.get(id.data);
  if (found === null) notFound();
  const problem = problemOf(found.match);
  const seats = await Promise.all(
    found.seats.map(async (s) => ({
      player: s.player,
      submitted: s.submittedAt !== null,
      total: s.total,
      design:
        (await deps.matches.latestVersion(id.data, s.userId))?.design ?? null,
    })),
  );
  return (
    <main className={VIEW_FRAME}>
      <header className={HEADER}>
        <CloseLink href="/hld/tournaments" label="Back to tournaments" />
        <span className={HEADER_TILE}>
          <Cube size={30} ramp="system-design" />
        </span>
        <div className="lg:min-w-[200px] lg:flex-1">
          <p className="hidden text-[13px] text-ink-muted lg:block">
            HLD battle · live
          </p>
          <h1 className={TITLE}>{problem.title}: live</h1>
        </div>
        <span className="text-sm text-ink-muted lg:flex lg:h-[38px] lg:items-center lg:rounded-full lg:bg-well lg:px-3">
          {found.seats.map((s) => s.player).join(" vs ")}
        </span>
      </header>
      <div className="lg:p-5">
        <Spectate
          matchId={id.data}
          problem={problem}
          initial={{
            over: found.match.closedAt !== null,
            deadline: found.match.deadlineAt.toISOString(),
            seats,
          }}
        />
      </div>
    </main>
  );
}
