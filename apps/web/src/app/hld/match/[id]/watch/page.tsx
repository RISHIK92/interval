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
    <main className="flex flex-col gap-4 px-4 pt-6 pb-12">
      <header className="mx-auto w-full max-w-6xl">
        <h1 className="text-display">{problem.title}: live</h1>
        <p className="text-sm text-ink-muted">
          {found.seats.map((s) => s.player).join(" vs ")}
        </p>
      </header>
      <div className="mx-auto w-full max-w-6xl">
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
