import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { gameEnv, windowTimeZone } from "../../../env";
import {
  battleWindows,
  entitlements,
  playerRatings,
  preferences,
  sessionReader,
} from "../../../server/container";
import { BattleRatingCard } from "../../BattleRatingCard";
import { PAGE_TITLE, Page } from "../../ui/Page";
import { windowStatus, windowsFrom } from "../../../server/battle-windows";
import { BattleLobby } from "./BattleLobby";

export const dynamic = "force-dynamic";

// P5-W32 (§6.6, MATCH-7; Q-P5-12, Q-P5-19): where battles start. The casual queue is
// always open (an unrated 1v1, or solo after 60 s); ranked play is in windows, nightly
// at 21:00 plus 11:00 at weekends, registered for until 5 minutes before.
export default async function BattleLobbyPage() {
  const actor = await sessionReader().current(await headers());
  if (actor === null) redirect("/play");
  const [battle, live] = await Promise.all([
    entitlements().can(actor.userId, "play.battle"),
    entitlements().can(actor.userId, "play.live"),
  ]);
  if (!battle || !live || gameEnv() === null) redirect("/play");
  const now = new Date();
  const [next] = windowsFrom(now, windowTimeZone());
  if (next === undefined)
    throw new Error("no battle window in the coming week");
  const [mine, chosen, human, ai] = await Promise.all([
    battleWindows().registration(next, actor.userId),
    preferences().get(actor.userId),
    // P5-W32 (Q-P5-18): the 1v1 battle rating in each battle mode.
    playerRatings().battleOf(actor.userId, "human"),
    playerRatings().battleOf(actor.userId, "ai"),
  ]);
  return (
    <Page
      tab="play"
      phoneTabBar={false}
      firstName={chosen?.firstName ?? null}
      railLabel="Your battles"
      rail={
        <BattleRatingCard kind="LLD" ratings={{ human, ai }}>
          <Link
            href="/play/boards/battles"
            className="flex h-10 items-center justify-center rounded-xl border-[1.5px] border-hairline-strong text-sm font-semibold"
          >
            Battle boards
          </Link>
        </BattleRatingCard>
      }
    >
      <BattleLobby
        header={
          <header>
            <h1 className={PAGE_TITLE}>LLD battles</h1>
            <p className="mt-1 text-ink-muted">
              Design and code a system against others in about 45 minutes, on a
              desktop browser.{" "}
              <Link
                href="/play/boards/battles"
                className="underline underline-offset-2 lg:hidden"
              >
                Battle boards
              </Link>
            </p>
          </header>
        }
        window={{
          at: next.toISOString(),
          status: windowStatus(next, now),
          registered: mine !== null,
          battleMode: mine?.battleMode ?? null,
          matchId: mine?.matchId ?? null,
        }}
      />
    </Page>
  );
}
