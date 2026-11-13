import { GENERATORS } from "@interval/lld";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { gameEnv } from "../../../../env";
import {
  battleQuestions,
  entitlements,
  matches,
  problems,
  sessionReader,
} from "../../../../server/container";
import { BattlePlay } from "./BattlePlay";
import { Interviewer } from "./Interviewer";

export const dynamic = "force-dynamic";

// P5-W31-S03 (§6.5; Q-P5-15, Q-P5-16; LLDQ-4): an LLD battle, for its players, on a desktop
// browser. The page has what any player may see: the statement, the visible examples,
// and each language's starter. The extension comes from the game server at the reveal,
// never from here.
const Id = z.uuid();

export default async function BattlePage(props: {
  params: Promise<{ id: string }>;
}) {
  const actor = await sessionReader().current(await headers());
  if (actor === null) redirect("/play");
  const [battle, live] = await Promise.all([
    entitlements().can(actor.userId, "play.battle"),
    entitlements().can(actor.userId, "play.live"),
  ]);
  if (!battle || !live || gameEnv() === null) redirect("/play");
  const id = Id.safeParse((await props.params).id);
  if (!id.success) notFound();
  const seat = await matches().serverFor(id.data, actor.userId);
  if (seat === null || seat.problem === null) notFound();
  const problem = await problems().get(seat.problem);
  if (problem === null) notFound();
  const starters = Object.fromEntries(
    Object.entries(GENERATORS).map(([language, generate]) => [
      language,
      generate(problem.interface).starter,
    ]),
  );
  return (
    <main className="mx-auto flex max-w-7xl flex-col gap-4 px-4 pt-6 pb-12">
      <header>
        <h1 className="text-display">{problem.title}</h1>
        <p className="mt-1 text-ink-muted">
          An LLD battle, about 45 minutes. The extension comes at 30:00. Best
          submission counts.
        </p>
      </header>
      {/* §6.5: battles are played in desktop browsers. */}
      <p className="text-ink-muted lg:hidden">
        Battles are played on a desktop browser.
      </p>
      <BattlePlay
        matchId={id.data}
        statement={problem.statement}
        examples={problem.visible.map((v) => JSON.stringify(v.scenario.calls))}
        starters={starters}
      />
      {/* §6.2 (Q-P5-13): the AI league's vague requirements have an interviewer. */}
      {problem.league === "ai" && (
        <Interviewer
          matchId={id.data}
          initial={await battleQuestions().list(id.data, actor.userId)}
        />
      )}
    </main>
  );
}
