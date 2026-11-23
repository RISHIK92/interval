import { headers } from "next/headers";
import { z } from "zod";
import { redirect } from "next/navigation";
import { gameEnv } from "../../../../env";
import {
  entitlements,
  preferences,
  sessionReader,
} from "../../../../server/container";
import { requireUsername } from "../../../username/gate";
import { LiveSprint } from "./LiveSprint";
import { INNER_PAGE_TITLE } from "../../../ui/Page";

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
  const [sprint, live, chosen] = await Promise.all([
    entitlements().can(actor.userId, "play.sprint"),
    entitlements().can(actor.userId, "play.live"),
    preferences().get(actor.userId),
  ]);
  if (!sprint || !live || gameEnv() === null) redirect("/play");
  return (
    <LiveSprint
      matchId={
        Match.safeParse((await props.searchParams).match).data ?? undefined
      }
      frame={{
        firstName: chosen?.firstName ?? null,
        intro: (
          <header>
            <h1 className={INNER_PAGE_TITLE}>Live sprint</h1>
            <p className="mt-1 text-ink-muted lg:mt-1.5">
              You and one opponent, the same questions, 60 seconds. Most correct
              wins.
            </p>
          </header>
        ),
        round: "mx-auto flex max-w-xl flex-col gap-6 px-4 pt-6 pb-12 lg:pt-10",
      }}
    />
  );
}
