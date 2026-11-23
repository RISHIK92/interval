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
import { FRAME, TITLE } from "../../../hld/Frame";
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
  const { interface: api } = problem;
  const call = (name: string, params: { name: string }[]) =>
    `${name}(${params.map((p) => p.name).join(", ")})`;
  return (
    <main className={FRAME}>
      <BattlePlay
        matchId={id.data}
        heading={
          <>
            <h1 className={TITLE}>{problem.title}</h1>
            <p className="mt-1 text-ink-muted lg:mt-0 lg:text-[13px]">
              An LLD battle, about 45 minutes. The extension comes at 30:00.
              Best submission counts.
            </p>
            {/* §6.5: battles are played in desktop browsers. */}
            <p className="mt-4 text-ink-muted lg:hidden">
              Battles are played on a desktop browser.
            </p>
          </>
        }
        signatures={[
          call(api.class, api.constructor.params),
          ...api.methods.map(
            (m) =>
              call(m.name, m.params) +
              (m.returns === "void" ? "" : ` → ${m.returns}`),
          ),
        ]}
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
