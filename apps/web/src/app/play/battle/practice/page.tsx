import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { gameEnv } from "../../../../env";
import {
  entitlements,
  lldPractice,
  preferences,
  problems,
  sessionReader,
} from "../../../../server/container";
import { PAGE_TITLE, Page, RailCard } from "../../../ui/Page";
import { PracticeTable, type PracticeRow } from "./PracticeTable";

export const dynamic = "force-dynamic";

// The Random problem button's: each render a new pick (the page is dynamic).
function anyOf<T>(items: T[]): T | undefined {
  return items[Math.floor(Math.random() * items.length)];
}

// ADR-0048 (Q-WD-28): LLD practice, on the battle screen with no clock and no opponent:
// the practice problems by topic, with the player's best on each.
export default async function PracticeList() {
  const actor = await sessionReader().current(await headers());
  if (actor === null) redirect("/play");
  const [battle, live] = await Promise.all([
    entitlements().can(actor.userId, "play.battle"),
    entitlements().can(actor.userId, "play.live"),
  ]);
  if (!battle || !live || gameEnv() === null) redirect("/play");
  const [listed, bests, chosen] = await Promise.all([
    problems().practice(),
    lldPractice().best(actor.userId),
    preferences().get(actor.userId),
  ]);
  const rows: PracticeRow[] = listed.map((p) => {
    const best = bests.get(p.slug);
    return {
      ...p,
      status:
        best === undefined
          ? null
          : `Best ${String(best.points)} · hidden ${String(best.layers.hidden.passed)}/${String(best.layers.hidden.total)}`,
    };
  });
  const random = anyOf(rows)?.slug ?? null;
  return (
    <Page
      tab="play"
      phoneTabBar={false}
      firstName={chosen?.firstName ?? null}
      className="flex flex-col gap-6 lg:gap-5"
      railLabel="Battles"
      rail={
        <RailCard href="/play/battle" className="flex flex-col gap-1">
          <span className="text-[15px] font-semibold">Ready to battle?</span>
          <span className="text-[13px] text-ink-muted">
            The LLD lobby: ranked windows and casual 1v1s.
          </span>
        </RailCard>
      }
    >
      <header>
        <h1 className={PAGE_TITLE}>LLD practice</h1>
        <p className="mt-1 text-ink-muted">
          Design and code a class against the battle&apos;s tests, with no clock
          and no opponent. Unrated; your best result is kept. Best on a desktop
          browser.
        </p>
      </header>
      <PracticeTable rows={rows} random={random} />
    </Page>
  );
}
