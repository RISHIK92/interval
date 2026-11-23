import { headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { gameEnv } from "../../../../../env";
import {
  entitlements,
  lldPractice,
  problems,
  sessionReader,
} from "../../../../../server/container";
import { FRAME, TITLE } from "../../../../hld/Frame";
import { screenOf } from "../../[id]/screen";
import { PracticePlay } from "./PracticePlay";

export const dynamic = "force-dynamic";

// ADR-0048 (Q-WD-28): a practice problem on the battle screen, with no clock and no
// opponent, unrated. The page starts the session (PracticePlay); the code is the player's
// saved copy, autosaved; the extension comes from the game server when they reveal it.
export default async function PracticePage(props: {
  params: Promise<{ slug: string }>;
}) {
  const actor = await sessionReader().current(await headers());
  if (actor === null) redirect("/play");
  const [battle, live] = await Promise.all([
    entitlements().can(actor.userId, "play.battle"),
    entitlements().can(actor.userId, "play.live"),
  ]);
  if (!battle || !live || gameEnv() === null) redirect("/play");
  const { slug } = await props.params;
  const problem = await problems().get(slug);
  // A battle problem is never practised: its hidden tests stay unprobed.
  if (problem?.pool !== "practice") notFound();
  const [saved, best] = await Promise.all([
    lldPractice().loadCode(actor.userId, slug),
    lldPractice().bestFor(actor.userId, slug),
  ]);
  return (
    <main className={FRAME}>
      <PracticePlay
        slug={slug}
        heading={
          <>
            <h1 className={TITLE}>{problem.title}</h1>
            <p className="mt-1 text-ink-muted lg:mt-0 lg:text-[13px]">
              Practice: no clock, unrated. Your best result is kept.{" "}
              <Link
                href="/play/battle/practice"
                className="underline underline-offset-2"
              >
                All practice problems
              </Link>
            </p>
            <p className="mt-4 text-ink-muted lg:hidden">
              Practice is best on a desktop browser.
            </p>
          </>
        }
        {...screenOf(problem)}
        best={
          best === null
            ? null
            : { points: best.points, hidden: best.layers.hidden }
        }
        hasExtension={problem.extension !== null}
        saved={Object.fromEntries(saved)}
      />
    </main>
  );
}
