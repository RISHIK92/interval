import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { gameEnv } from "../../../../env";
import { entitlements, sessionReader } from "../../../../server/container";
import { requireUsername } from "../../../username/gate";
import { LiveFinger } from "./LiveFinger";

export const dynamic = "force-dynamic";

// P3-W16-S05 (§6.3, Q-P3-24): live fastest finger, for accounts and guests (ADR-0029)
// whose plan has live games (OPS-3), once live games are configured.
export default async function LiveFingerPage() {
  const actor = await sessionReader().current(await headers());
  if (actor === null) redirect("/play");
  if (!actor.isGuest)
    await requireUsername(actor.userId, "/play/live/fastest-finger");
  if (
    !(await entitlements().can(actor.userId, "play.live")) ||
    gameEnv() === null
  )
    redirect("/play");
  return (
    <main className="mx-auto flex max-w-xl flex-col gap-6 px-4 pt-6 pb-12 lg:pt-10">
      <header>
        <h1 className="text-display">Fastest finger</h1>
        <p className="mt-1 text-ink-muted">
          You and one opponent, 7 rounds. The first right answer takes each
          round; one answer each.
        </p>
      </header>
      <LiveFinger />
    </main>
  );
}
