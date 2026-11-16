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
import { Canvas } from "../../Canvas";

export const dynamic = "force-dynamic";

// P6-W42 (§6.4, CANVAS-1, Q-P6-06): a match, for its players: the problem, the canvas
// from the player's last autosave, the clock and the submission. Over, it's the results.
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
  return (
    <main className="flex flex-col gap-4 px-4 pt-6 pb-12">
      <header className="mx-auto w-full max-w-6xl">
        <h1 className="text-display">{problem.title}</h1>
        <p className="text-sm text-ink-muted">
          {found.seats.map((s) => s.player).join(" vs ")}
          {found.match.unrated ? " · unrated" : ""} · the {found.match.league}{" "}
          league
        </p>
        <ul className="mt-1 list-disc pl-5 text-ink-muted">
          {problem.requirements.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </header>
      <Canvas
        problem={problem}
        initial={parsed.success ? parsed.data : starterDesign()}
        version={latest?.version ?? 0}
        mode={{
          kind: "match",
          matchId: id.data,
          deadline: found.match.deadlineAt.toISOString(),
          submitted: seat.submittedAt !== null,
        }}
      />
    </main>
  );
}
