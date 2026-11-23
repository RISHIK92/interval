import { practiceProblems } from "@interval/hld";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  entitlements,
  preferences,
  sessionReader,
} from "../../../server/container";
import { CUBE } from "../../LobbyCard";
import { Card } from "../../ui/Card";
import { PAGE_TITLE, Page, RailCard } from "../../ui/Page";

export const dynamic = "force-dynamic";

// P6-W39 (ADR-0042 PROPOSED): HLD practice. Design a system for a problem on the
// canvas, with its simulation live as it's drawn; no clock, no opponent.
export default async function PracticePage() {
  const actor = await sessionReader().current(await headers());
  if (actor === null) redirect("/play");
  if (!(await entitlements().can(actor.userId, "play.hld"))) redirect("/play");
  const chosen = await preferences().get(actor.userId);
  return (
    <Page
      tab="play"
      phoneTabBar={false}
      firstName={chosen?.firstName ?? null}
      className="flex flex-col gap-6 lg:gap-5"
      railLabel="Study"
      rail={
        <>
          <RailCard href="/hld/spec" className="flex flex-col gap-1">
            <span className="text-[15px] font-semibold">The spec sheet</span>
            <span className="text-[13px] text-ink-muted">
              Every component&apos;s numbers, as the simulator uses them.
            </span>
          </RailCard>
          <RailCard href="/hld/play" className="flex flex-col gap-1">
            <span className="text-[15px] font-semibold">Ready to battle?</span>
            <span className="text-[13px] text-ink-muted">
              The system design lobby: ranked windows and casual 1v1s.
            </span>
          </RailCard>
        </>
      }
    >
      <header>
        <h1 className={PAGE_TITLE}>System design practice</h1>
        <p className="mt-1 text-ink-muted">
          Build a design from the{" "}
          <Link href="/hld/spec" className="underline underline-offset-2">
            spec sheet&apos;s components
          </Link>{" "}
          and watch it run through each scenario as you draw. Best on a desktop
          browser.
        </p>
      </header>
      <ul className="grid gap-3 sm:grid-cols-2 lg:gap-3.5">
        {practiceProblems().map((p) => (
          <li key={p.slug}>
            <Link href={`/hld/practice/${p.slug}`} className="block h-full">
              <Card className="flex h-full gap-4 p-5 lg:rounded-[22px] lg:p-[18px] lg:shadow-none lg:hover:border-hairline-strong">
                <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-(--system-design-tint) lg:size-14">
                  {CUBE}
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="text-section">{p.title}</span>
                  <span className="text-[13px] text-ink-muted tabular-nums">
                    {p.scenarios.length} scenarios · a budget of $
                    {p.budgetPerMonth.toLocaleString("en-US")} a month
                  </span>
                  <span className="mt-1 line-clamp-3 text-sm text-ink-muted">
                    {p.requirements.join(" · ")}
                  </span>
                </span>
              </Card>
            </Link>
          </li>
        ))}
      </ul>
    </Page>
  );
}
