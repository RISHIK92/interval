import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { windowTimeZone } from "../../../env";
import { windowStatus, windowsFrom } from "../../../server/battle-windows";
import {
  entitlements,
  hldDeps,
  hldMatches,
  hldWindows,
  sessionReader,
} from "../../../server/container";
import { advance } from "../../../server/hld-matches";
import { HldLobby } from "./HldLobby";

export const dynamic = "force-dynamic";

// P6-W42 (§6.4, MATCH-7; Q-P6-06): where HLD battles start. The player's own matches
// left unscored move on here too (ADR-0043), so leaving a match never strands it.
export default async function HldPlayPage() {
  const actor = await sessionReader().current(await headers());
  if (actor === null) redirect("/play");
  if (!(await entitlements().can(actor.userId, "play.hld"))) redirect("/play");
  const deps = hldDeps();
  const open = await hldMatches().unscoredFor(actor.userId);
  for (const id of open) await advance(deps, id);
  const now = new Date();
  const [next] = windowsFrom(now, windowTimeZone());
  if (next === undefined) throw new Error("no window in the coming week");
  const mine = await hldWindows().registration(next, actor.userId);
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 pt-6 pb-12">
      <header>
        <h1 className="text-display">System design battles</h1>
        <p className="mt-1 text-ink-muted">
          Design a system against the clock: simulation 60, the AI rubric 25,
          speed 15. Best on a desktop browser.{" "}
          <Link href="/hld/spec" className="underline">
            The spec sheet
          </Link>{" "}
          ·{" "}
          <Link href="/hld/practice" className="underline">
            Practice
          </Link>
        </p>
      </header>
      <HldLobby
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
