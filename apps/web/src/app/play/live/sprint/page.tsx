import { headers } from "next/headers";
import { z } from "zod";
import { redirect } from "next/navigation";
import { gameEnv } from "../../../../env";
import { entitlements, sessionReader } from "../../../../server/container";
import { requireUsername } from "../../../username/gate";
import { LiveSprint } from "./LiveSprint";

export const dynamic = "force-dynamic";

// P3-W16-S04 (§6.3, Q-P3-23): the live 1v1 sprint, for accounts and guests (ADR-0029)
// whose plan has the sprint and live games (OPS-3), once live games are configured.
// P3-W17-S03: ?match= joins a friend challenge's match (the ticket route checks the
// player is in it).
const Match = z.uuid();

export default async function LiveSprintPage(props: {
  searchParams: Promise<{ match?: string | string[] }>;
}) {
  const actor = await sessionReader().current(await headers());
  if (actor === null) redirect("/play");
  if (!actor.isGuest) await requireUsername(actor.userId, "/play/live/sprint");
  const [sprint, live] = await Promise.all([
    entitlements().can(actor.userId, "play.sprint"),
    entitlements().can(actor.userId, "play.live"),
  ]);
  if (!sprint || !live || gameEnv() === null) redirect("/play");
  return (
    <main className="mx-auto flex max-w-xl flex-col gap-6 px-4 pt-6 pb-12 lg:pt-10">
      <header>
        <h1 className="text-display">Live sprint</h1>
        <p className="mt-1 text-ink-muted">
          You and one opponent, the same questions, 60 seconds. Most correct
          wins.
        </p>
      </header>
      <LiveSprint
        matchId={
          Match.safeParse((await props.searchParams).match).data ?? undefined
        }
      />
    </main>
  );
}
