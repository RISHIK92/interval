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
            <Link
              href={`/hld/practice/${p.slug}`}
              className="group block h-full rounded-3xl focus-visible:ring-2 focus-visible:ring-select focus-visible:outline-none lg:rounded-[22px]"
            >
              <Card className="flex h-full gap-4 p-5 transition-colors lg:rounded-[22px] lg:p-[18px] lg:shadow-none lg:group-hover:border-hairline-strong">
                <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-(--system-design-tint) lg:size-14">
                  {CUBE}
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <span className="flex items-start justify-between gap-3">
                    <span className="text-section">{p.title}</span>
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 24 24"
                      className="mt-1 size-4 shrink-0 text-ink-muted transition-transform group-hover:translate-x-0.5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="m9 6 6 6-6 6" />
                    </svg>
                  </span>
                  <span className="text-[13px] text-ink-muted tabular-nums">
                    {p.scenarios.length} scenarios · $
                    {p.budgetPerMonth.toLocaleString("en-US")} a month budget
                  </span>
                  {p.concepts.length === 0 ? null : (
                    <span className="mt-1 flex flex-wrap gap-1.5">
                      <span className="sr-only">Concepts: </span>
                      {p.concepts.map((c) => (
                        <span
                          key={c}
                          className="rounded-full bg-well px-2.5 py-1 text-xs font-semibold text-ink-muted"
                        >
                          {c}
                        </span>
                      ))}
                    </span>
                  )}
                  <span className="mt-1 line-clamp-2 text-sm text-ink-muted">
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
