import {
  type Difficulty,
  FAMILIES,
  practiceProblems,
  type Theme,
  THEMES,
} from "@interval/hld";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  entitlements,
  preferences,
  sessionReader,
} from "../../../server/container";
import { Card } from "../../ui/Card";
import { PAGE_TITLE, Page, RailCard } from "../../ui/Page";

export const dynamic = "force-dynamic";

// ADR-0050 §1: the catalog's theme names (docs/hld-catalog.md), in its order.
const THEME_NAMES: Record<Theme, string> = {
  storage: "Storage & files",
  feeds: "Feeds & social",
  messaging: "Messaging & notifications",
  search: "Search",
  commerce: "Commerce & payments",
  realtime: "Real-time & location",
  pipelines: "Data pipelines & analytics",
  infrastructure: "Infrastructure building blocks",
};

// As LLD practice's table shows difficulty (ADR-0048).
const DIFFICULTY_CHIPS: Record<Difficulty, string> = {
  easy: "bg-go-soft text-go-text",
  medium: "bg-(--system-design-tint) text-(--system-design-line)",
  hard: "bg-[color-mix(in_srgb,var(--wrong)_12%,var(--page))] text-wrong",
};

const CELL = "px-3 py-2.5 lg:px-4";

// P6-W39 (ADR-0042 PROPOSED): HLD practice. Design a system for a problem on the
// canvas, with its simulation live as it's drawn; no clock, no opponent. ADR-0050 §1:
// the practice families (every family until the pools split, Q-WD-31), grouped by
// theme with their difficulty.
export default async function PracticePage() {
  const actor = await sessionReader().current(await headers());
  if (actor === null) redirect("/play");
  if (!(await entitlements().can(actor.userId, "play.hld"))) redirect("/play");
  const chosen = await preferences().get(actor.userId);
  const rows = practiceProblems().flatMap((problem) => {
    const family = FAMILIES.find((f) => f.slug === problem.slug);
    return family === undefined
      ? []
      : [{ problem, theme: family.theme, difficulty: family.difficulty }];
  });
  const groups = THEMES.map((theme) => ({
    theme,
    rows: rows.filter((r) => r.theme === theme),
  })).filter((g) => g.rows.length > 0);
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
      {groups.map((g) => (
        <section key={g.theme} aria-label={THEME_NAMES[g.theme]}>
          <h2 className="mb-2 flex items-baseline gap-2 text-section">
            {THEME_NAMES[g.theme]}
            <span className="text-[13px] font-normal text-ink-muted tabular-nums">
              {g.rows.length} {g.rows.length === 1 ? "problem" : "problems"}
            </span>
          </h2>
          <Card className="overflow-hidden p-0 lg:rounded-[22px] lg:shadow-none">
            <table className="w-full border-collapse text-left text-sm">
              <thead className="text-[13px] text-ink-muted">
                <tr className="border-b border-hairline">
                  <th scope="col" className={CELL}>
                    Problem
                  </th>
                  <th scope="col" className={`hidden md:table-cell ${CELL}`}>
                    Concepts
                  </th>
                  <th scope="col" className={CELL}>
                    Difficulty
                  </th>
                  <th scope="col" className={`hidden sm:table-cell ${CELL}`}>
                    Budget
                  </th>
                </tr>
              </thead>
              <tbody>
                {g.rows.map(({ problem: p, difficulty }) => (
                  <tr
                    key={p.slug}
                    className="border-b border-hairline last:border-b-0"
                  >
                    <td className={CELL}>
                      <Link
                        href={`/hld/practice/${p.slug}`}
                        className="font-semibold underline-offset-2 hover:underline"
                      >
                        {p.title}
                      </Link>
                      <span className="block text-[13px] text-ink-muted tabular-nums">
                        {p.scenarios.length} scenarios
                      </span>
                    </td>
                    <td
                      className={`hidden text-ink-muted md:table-cell ${CELL}`}
                    >
                      {p.concepts.join(", ")}
                    </td>
                    <td className={CELL}>
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-semibold ${DIFFICULTY_CHIPS[difficulty]}`}
                      >
                        {difficulty}
                      </span>
                    </td>
                    <td
                      className={`hidden text-ink-muted tabular-nums sm:table-cell ${CELL}`}
                    >
                      ${p.budgetPerMonth.toLocaleString("en-US")} a month
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </section>
      ))}
    </Page>
  );
}
