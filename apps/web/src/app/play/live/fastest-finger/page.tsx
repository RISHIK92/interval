import { headers } from "next/headers";
import { z } from "zod";
import { redirect } from "next/navigation";
import { gameEnv } from "../../../../env";
import {
  entitlements,
  preferences,
  sessionReader,
} from "../../../../server/container";
import { LIVE_QUESTIONS } from "../../../../server/ports";
import { requireUsername } from "../../../username/gate";
import { LiveFinger } from "./LiveFinger";
import { INNER_PAGE_TITLE } from "../../../ui/Page";

export const dynamic = "force-dynamic";

// P3-W16-S05 (§6.3, Q-P3-24): live fastest finger, for accounts and guests (ADR-0029)
// whose plan has live games (OPS-3), once live games are configured.
// P3-W17-S03: ?match= joins a friend challenge's match (the ticket route checks the
// player is in it).
const Match = z.uuid();

export default async function LiveFingerPage(props: {
  searchParams: Promise<{ match?: string | string[] }>;
}) {
  const actor = await sessionReader().current(await headers());
  if (actor === null) redirect("/play");
  if (!actor.isGuest)
    await requireUsername(actor.userId, "/play/live/fastest-finger");
  if (
    !(await entitlements().can(actor.userId, "play.live")) ||
    gameEnv() === null
  )
    redirect("/play");
  const chosen = await preferences().get(actor.userId);
  return (
    <LiveFinger
      matchId={
        Match.safeParse((await props.searchParams).match).data ?? undefined
      }
      frame={{
        firstName: chosen?.firstName ?? null,
        intro: (
          <header>
            <h1 className={INNER_PAGE_TITLE}>Fastest finger</h1>
            <p className="mt-1 text-ink-muted lg:mt-1.5">
              You and one opponent, {LIVE_QUESTIONS.fastest_finger} rounds. The
              first right answer takes each round; one answer each.
            </p>
          </header>
        ),
        round:
          "mx-auto flex max-w-xl flex-col gap-6 px-4 pt-6 pb-12 lg:max-w-[56.5rem] lg:px-8 lg:pt-7",
      }}
    />
  );
}
