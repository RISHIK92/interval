"use client";

// Types only: @interval/lld's entry also exports the verifier (node:child_process),
// which can't be bundled for the browser.
import type { PracticeTopic } from "@interval/lld";
import Link from "next/link";
import { useState } from "react";
import type { PracticeProblem } from "../../../../server/ports";
import { Card } from "../../../ui/Card";

// ADR-0048 (Q-WD-28): the practice problems as a table, in topic groups (each with its
// count) or, with groups hidden, as one list. `status`: the player's best, or null
// before a first judged Submit.
export type PracticeRow = PracticeProblem & { status: string | null };

export const TOPIC_NAMES: Record<PracticeTopic, string> = {
  "oop-basics": "OOP basics",
  relationships: "Relationships",
  principles: "Principles",
  solid: "SOLID",
  creational: "Creational patterns",
  structural: "Structural patterns",
  behavioural: "Behavioural patterns",
  systems: "Systems",
};

const DIFFICULTY_CHIPS: Record<PracticeProblem["difficulty"], string> = {
  easy: "bg-go-soft text-go-text",
  medium: "bg-(--system-design-tint) text-(--system-design-line)",
  hard: "bg-[color-mix(in_srgb,var(--wrong)_12%,var(--page))] text-wrong",
};

const CELL = "px-3 py-2.5 lg:px-4";

// The groups in the order the names are listed (every topic is named).
const TOPIC_ORDER = Object.keys(TOPIC_NAMES) as PracticeTopic[];

export function PracticeTable({
  rows,
  random,
}: {
  rows: PracticeRow[];
  random: string | null; // a problem's slug, picked by the page
}) {
  const [grouped, setGrouped] = useState(true);
  const groups = grouped
    ? TOPIC_ORDER.map((topic) => ({
        topic: TOPIC_NAMES[topic],
        rows: rows.filter((r) => r.topic === topic),
      })).filter((g) => g.rows.length > 0)
    : [{ topic: null, rows }];
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {random === null ? null : (
          <Link
            href={`/play/battle/practice/${random}`}
            className="inline-flex items-center rounded-full bg-ink px-4 py-2 text-sm font-semibold text-page lg:rounded-xl"
          >
            Random problem
          </Link>
        )}
        <button
          type="button"
          aria-pressed={!grouped}
          onClick={() => {
            setGrouped(!grouped);
          }}
          className="inline-flex items-center rounded-full border-[1.5px] border-hairline-strong px-4 py-2 text-sm font-semibold lg:rounded-xl"
        >
          {grouped ? "Hide groups" : "Show groups"}
        </button>
      </div>
      {rows.length === 0 ? (
        <p className="text-ink-muted">No practice problems yet.</p>
      ) : null}
      {groups.map((g) => (
        <section key={g.topic ?? "all"} aria-label={g.topic ?? "All problems"}>
          {g.topic === null ? null : (
            <h2 className="mb-2 flex items-baseline gap-2 text-section">
              {g.topic}
              <span className="text-[13px] font-normal text-ink-muted tabular-nums">
                {g.rows.length} {g.rows.length === 1 ? "problem" : "problems"}
              </span>
            </h2>
          )}
          <Card className="overflow-hidden p-0 lg:rounded-[22px] lg:shadow-none">
            <table className="w-full border-collapse text-left text-sm">
              <thead className="text-[13px] text-ink-muted">
                <tr className="border-b border-hairline">
                  <th
                    scope="col"
                    className={`hidden w-10 sm:table-cell ${CELL}`}
                  >
                    #
                  </th>
                  <th scope="col" className={CELL}>
                    Problem
                  </th>
                  <th scope="col" className={`hidden md:table-cell ${CELL}`}>
                    Topic
                  </th>
                  <th scope="col" className={CELL}>
                    Difficulty
                  </th>
                  <th scope="col" className={`hidden sm:table-cell ${CELL}`}>
                    Your best
                  </th>
                </tr>
              </thead>
              <tbody>
                {g.rows.map((r, i) => (
                  <tr
                    key={r.slug}
                    className="border-b border-hairline last:border-b-0"
                  >
                    <td
                      className={`hidden text-ink-muted tabular-nums sm:table-cell ${CELL}`}
                    >
                      {i + 1}
                    </td>
                    <td className={CELL}>
                      <Link
                        href={`/play/battle/practice/${r.slug}`}
                        className="font-semibold underline-offset-2 hover:underline"
                      >
                        {r.title}
                      </Link>
                      {/* Phones: the best under the title, the columns being few. */}
                      <span className="block text-[13px] text-ink-muted sm:hidden">
                        {r.status ?? "Not started"}
                      </span>
                    </td>
                    <td
                      className={`hidden text-ink-muted md:table-cell ${CELL}`}
                    >
                      {r.concepts.length > 0
                        ? r.concepts.join(", ")
                        : TOPIC_NAMES[r.topic]}
                    </td>
                    <td className={CELL}>
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-semibold ${DIFFICULTY_CHIPS[r.difficulty]}`}
                      >
                        {r.difficulty}
                      </span>
                    </td>
                    <td
                      className={`hidden text-ink-muted tabular-nums sm:table-cell ${CELL}`}
                    >
                      {r.status ?? "Not started"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </section>
      ))}
    </div>
  );
}
