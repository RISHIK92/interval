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
import { PAGE_TITLE, Page, RailCard } from "../../ui/Page";
import { startsAt } from "./startsAt";

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
      railLabel="Battles"
      rail={
        <RailCard href="/hld/play" className="flex flex-col gap-1">
          <span className="text-[15px] font-semibold">
            System design battles
          </span>
          <span className="text-[13px] text-ink-muted">
            The lobby: ranked windows and casual 1v1s.
          </span>
        </RailCard>
      }
    >
      {/* The sidebar's Play does this on wide screens. */}
      <Link
        href="/play"
        className="-mb-3 text-sm text-ink-muted underline lg:hidden"
      >
        Back to Play
      </Link>
      <header>
        <h1 className={PAGE_TITLE}>System design tournaments</h1>
        <p className="mt-1 text-ink-muted">
          Five Swiss rounds, then a bracket of the top 8.
        </p>
      </header>
      {all.length === 0 ? (
        <Card className="flex flex-col items-start gap-3 p-6 lg:rounded-[22px] lg:p-[22px] lg:shadow-none">
          <div>
            <p className="text-section">No tournaments scheduled yet</p>
            <p className="mt-1 text-sm text-ink-muted">
              Tournaments are announced here. Practice in the meantime.
            </p>
          </div>
          <Link
            href="/hld/practice"
            className="inline-flex items-center rounded-full bg-ink px-5 py-2.5 font-semibold text-page lg:rounded-xl lg:px-4 lg:py-2 lg:text-sm"
          >
            Practice
          </Link>
        </Card>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:gap-3.5">
          {all.map((t) => (
            <li key={t.id}>
              <Link
                href={`/hld/tournaments/${t.id}`}
                className="group block h-full rounded-3xl focus-visible:ring-2 focus-visible:ring-select focus-visible:outline-none lg:rounded-[22px]"
              >
                <Card className="flex h-full gap-4 p-5 lg:rounded-[22px] lg:p-[18px] lg:shadow-none lg:group-hover:border-hairline-strong">
                  <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-(--review-tint) text-(--review-line) lg:size-14">
                    {TROPHY}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="flex items-start justify-between gap-3">
                      <span className="text-section">{t.name}</span>
                      <span
                        className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${t.finishedAt !== null ? "bg-well text-ink-muted" : t.round === 0 ? "bg-go-soft text-go-text" : "bg-live/15 text-live"}`}
                      >
                        {t.finishedAt === null && t.round > 0 ? (
                          <span
                            aria-hidden="true"
                            className="size-1.5 rounded-full bg-live"
                          />
                        ) : null}
                        {t.finishedAt !== null
                          ? "Finished"
                          : t.round === 0
                            ? "Registration open"
                            : `Round ${String(t.round)}`}
                      </span>
                    </span>
                    <span className="text-[13px] text-ink-muted tabular-nums">
                      {startsAt(t.startsAt)} · {BATTLE_MODE_NAMES[t.battleMode]}
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
