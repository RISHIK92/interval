import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { gameEnv, windowTimeZone } from "../../../env";
import {
  battleWindows,
  entitlements,
  sessionReader,
} from "../../../server/container";
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
  const mine = await battleWindows().registration(next, actor.userId);
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 pt-6 pb-12">
      <header>
        <h1 className="text-display">LLD battles</h1>
        <p className="mt-1 text-ink-muted">
          Design and code a system against others in about 45 minutes, on a
          desktop browser.{" "}
          <Link href="/play/boards/battles" className="underline">
            Battle boards
          </Link>
        </p>
      </header>
      <BattleLobby
        window={{
          at: next.toISOString(),
          status: windowStatus(next, now),
          registered: mine !== null,
          league: mine?.league ?? null,
          matchId: mine?.matchId ?? null,
        }}
      />
    </main>
  );
}
