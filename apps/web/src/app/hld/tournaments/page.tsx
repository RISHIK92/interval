import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  entitlements,
  hldTournaments,
  preferences,
  sessionReader,
} from "../../../server/container";
import { BATTLE_MODE_NAMES } from "../../battle-mode";
import { TROPHY } from "../../LobbyCard";
import { Card } from "../../ui/Card";
import { PAGE_TITLE, Page } from "../../ui/Page";

export const dynamic = "force-dynamic";

// P6-W43 (§6.4, Q-P6-07): HLD tournaments, the coming ones first.
export default async function TournamentsPage() {
  const actor = await sessionReader().current(await headers());
  if (actor === null) redirect("/play");
  if (!(await entitlements().can(actor.userId, "play.hld"))) redirect("/play");
  const [all, chosen] = await Promise.all([
    hldTournaments().list(),
    preferences().get(actor.userId),
  ]);
  return (
    <Page
      tab="play"
      phoneTabBar={false}
      firstName={chosen?.firstName ?? null}
      className="flex flex-col gap-6 lg:gap-5"
    >
      <header>
        <h1 className={PAGE_TITLE}>System design tournaments</h1>
        <p className="mt-1 text-ink-muted">
          Five Swiss rounds, then a bracket of the top 8.
        </p>
      </header>
      {all.length === 0 ? (
        <Card className="p-8 text-center text-ink-muted lg:rounded-[22px] lg:shadow-none">
          <p>None scheduled yet.</p>
        </Card>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:gap-3.5">
          {all.map((t) => (
            <li key={t.id}>
              <Link href={`/hld/tournaments/${t.id}`} className="block h-full">
                <Card className="flex h-full gap-4 p-5 lg:rounded-[22px] lg:p-[18px] lg:shadow-none lg:hover:border-hairline-strong">
                  <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-(--review-tint) text-(--review-line) lg:size-14">
                    {TROPHY}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="flex items-start justify-between gap-3">
                      <span className="text-section">{t.name}</span>
                      <span
                        className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${t.finishedAt === null && t.round === 0 ? "bg-go-soft text-go-text" : "bg-well text-ink-muted"}`}
                      >
                        {t.finishedAt !== null
                          ? "finished"
                          : t.round === 0
                            ? "registration open"
                            : `round ${String(t.round)}`}
                      </span>
                    </span>
                    <span className="text-[13px] text-ink-muted tabular-nums">
                      {t.startsAt.toISOString().slice(0, 16).replace("T", " ")}{" "}
                      UTC · {BATTLE_MODE_NAMES[t.battleMode]}
                    </span>
                  </span>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Page>
  );
}
