import { headers } from "next/headers";
import Link from "next/link";
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
import { Replay } from "./Replay";

export const dynamic = "force-dynamic";

// P6-W44 (Q-P6-03, Q-P6-08): a finished match's replay, for its players, and for anyone
// once a tournament round is over.
export default async function ReplayPage(props: {
  params: Promise<{ id: string }>;
}) {
  const actor = await sessionReader().current(await headers());
  if (actor === null) redirect("/play");
  if (!(await entitlements().can(actor.userId, "play.hld"))) redirect("/play");
  const id = z.uuid().safeParse((await props.params).id);
  if (!id.success) notFound();
  const deps = { matches: hldMatches(), tournaments: hldTournaments() };
  const access = await accessTo(deps, id.data, actor.userId);
  if (access === "live") redirect(`/hld/match/${id.data}/watch`);
  if (access === null) notFound();
  const found = await deps.matches.get(id.data);
  if (found === null) notFound();
  const problem = problemOf(found.match);
  const mine = found.seats.some((s) => s.userId === actor.userId);
  return (
    <main className="flex flex-col gap-4 px-4 pt-6 pb-12">
      <header className="mx-auto w-full max-w-6xl">
        <h1 className="text-display">{problem.title}: replay</h1>
        <p className="text-sm text-ink-muted">
          {found.seats.map((s) => s.player).join(" vs ")}
          {mine ? (
            <>
              {" · "}
              <Link href={`/hld/match/${id.data}/result`} className="underline">
                Results
              </Link>
            </>
          ) : null}
        </p>
      </header>
      <div className="mx-auto w-full max-w-6xl">
        <Replay matchId={id.data} problem={problem} />
      </div>
    </main>
  );
}
