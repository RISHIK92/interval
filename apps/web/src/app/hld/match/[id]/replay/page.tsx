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
import { Cube } from "../../../flow";
import {
  CloseLink,
  HEADER,
  HEADER_TILE,
  TITLE,
  VIEW_FRAME,
} from "../../../Frame";
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
    <main className={VIEW_FRAME}>
      <header className={HEADER}>
        <CloseLink
          href={mine ? `/hld/match/${id.data}/result` : "/hld/tournaments"}
          label={mine ? "Back to the results" : "Back to tournaments"}
        />
        <span className={HEADER_TILE}>
          <Cube size={30} ramp="system-design" />
        </span>
        <div className="lg:min-w-[200px] lg:flex-1">
          <p className="hidden text-[13px] text-ink-muted lg:block">
            HLD battle · replay
          </p>
          <h1 className={TITLE}>{problem.title}: replay</h1>
        </div>
        <p className="text-sm text-ink-muted lg:flex lg:h-[38px] lg:items-center lg:rounded-full lg:bg-well lg:px-3">
          {found.seats.map((s) => s.player).join(" vs ")}
          {mine ? (
            <>
              {" · "}
              <Link
                href={`/hld/match/${id.data}/result`}
                className="font-semibold text-ink underline underline-offset-2"
              >
                Results
              </Link>
            </>
          ) : null}
        </p>
      </header>
      <div className="lg:p-5">
        <Replay matchId={id.data} problem={problem} />
      </div>
    </main>
  );
}
