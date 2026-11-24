import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { gameEnv } from "../../../../env";
import {
  battleCode,
  battleQuestions,
  battleResults,
  entitlements,
  matches,
  problems,
  sessionReader,
} from "../../../../server/container";
import { CANVAS_FRAME, TITLE } from "../../../hld/Frame";
import { BattlePlay } from "./BattlePlay";
import { Interviewer } from "./Interviewer";
import { screenOf } from "./screen";

export const dynamic = "force-dynamic";

const ABOUT =
  "An LLD battle, about 45 minutes. The extension comes at 30:00. Best submission counts.";

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
  // Q-WD-14: the opponents' names, for their pills' initials; Q-WD-17: the player's
  // code as last autosaved, for a reload or another device.
  const [names, autosaved] = await Promise.all([
    battleResults().names(id.data, actor.userId),
    battleCode().load(id.data, actor.userId),
  ]);
  return (
    // The frame fits the window on a desktop: each column scrolls on its own, and Run
    // tests and Submit stay in view.
    <main className={CANVAS_FRAME}>
      <BattlePlay
        matchId={id.data}
        heading={
          <>
            <h1 className={TITLE}>{problem.title}</h1>
            {/* A desktop has it under the Tests heading. */}
            <p className="mt-1 text-ink-muted lg:hidden">{ABOUT}</p>
            {/* §6.5: battles are played in desktop browsers. */}
            <p className="mt-4 text-ink-muted lg:hidden">
              Battles are played on a desktop browser.
            </p>
          </>
        }
        about={ABOUT}
        autosaved={autosaved}
        players={names ?? {}}
        {...(problem.battleMode === "ai"
          ? {
              // §6.2 (Q-P5-13): the AI mode's vague requirements have an interviewer.
              interviewer: (
                <Interviewer
                  matchId={id.data}
                  initial={await battleQuestions().list(id.data, actor.userId)}
                />
              ),
            }
          : {})}
        {...screenOf(problem)}
      />
    </main>
  );
}
