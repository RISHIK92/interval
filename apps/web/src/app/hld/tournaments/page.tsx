import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  entitlements,
  hldTournaments,
  sessionReader,
} from "../../../server/container";
import { BATTLE_MODE_NAMES } from "../../battle-mode";

export const dynamic = "force-dynamic";

// P6-W43 (§6.4, Q-P6-07): HLD tournaments, the coming ones first.
export default async function TournamentsPage() {
  const actor = await sessionReader().current(await headers());
  if (actor === null) redirect("/play");
  if (!(await entitlements().can(actor.userId, "play.hld"))) redirect("/play");
  const all = await hldTournaments().list();
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 pt-6 pb-12">
      <h1 className="text-display">System design tournaments</h1>
      {all.length === 0 ? (
        <p className="text-ink-muted">None scheduled yet.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {all.map((t) => (
            <li key={t.id} className="rounded-md border border-line p-3">
              <Link
                href={`/hld/tournaments/${t.id}`}
                className="text-title underline"
              >
                {t.name}
              </Link>
              <p className="text-sm text-ink-muted">
                {t.startsAt.toISOString().slice(0, 16).replace("T", " ")} UTC ·
                {BATTLE_MODE_NAMES[t.battleMode]} ·{" "}
                {t.finishedAt !== null
                  ? "finished"
                  : t.round === 0
                    ? "registration open"
                    : `round ${String(t.round)}`}
              </p>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
