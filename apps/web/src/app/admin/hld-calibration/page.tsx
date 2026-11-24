import { calibrationCandidates } from "@interval/hld";
import { currentSuggestion } from "@interval/hld/suggestions";
import Link from "next/link";
import { hldJudgements } from "../../../server/container";
import { Card } from "../../ui/Card";
import { requireAdmin } from "../guard";
import { ACCEPT_ALL, LEVEL_OPTIONS } from "../hld-grades";
import { JudgedDesign } from "../JudgedDesign";
import { ACT, ADMIN_MAIN, SECONDARY } from "../style";
import { gradeCandidateAction } from "./actions";

export const dynamic = "force-dynamic";

// P6-W41 (CANVAS-6, AI-5, Q-P6-05): the calibration set for the owner to grade.
// `eval-hld-judge` (the worker) measures the judge's agreement with these grades; an
// injection design's notes try to steer the judge, and should be graded on the design
// alone. Beside each criterion, Claude's suggested level (owner decision 2026-11-24),
// labelled AI (AI-1): it is stored only when the owner accepts it, as the owner's grade.
// One written for an earlier version of the design is marked outdated, never offered
// (Q-WD-32).
export default async function HldCalibrationPage(props: {
  searchParams: Promise<{ saved?: string; filter?: string }>;
}) {
  await requireAdmin();
  const { saved, filter } = await props.searchParams;
  const ungradedOnly = filter === "ungraded";
  const candidates = calibrationCandidates();
  const grades = await hldJudgements().calibrationGrades();
  const graded = (id: string, criteria: number) =>
    Object.keys(grades.get(id) ?? {}).length === criteria;
  const done = candidates.filter((c) =>
    graded(c.id, c.input.rubric.length),
  ).length;
  const shown = ungradedOnly
    ? candidates.filter((c) => !graded(c.id, c.input.rubric.length))
    : candidates;
  return (
    <main className={ADMIN_MAIN}>
      <h1 className="text-title">HLD judge calibration</h1>
      <p className="text-sm text-ink-muted">
        {done} of {candidates.length} designs graded. Run{" "}
        <code>python -m interval_jobs eval-hld-judge --model M</code> to measure
        the judge against them (it calls the model). Suggestions are
        Claude&apos;s (AI, provisional): only the grades you save or accept
        count.
      </p>
      <nav className="flex gap-3 text-sm">
        <Link
          href="/admin/hld-calibration"
          aria-current={ungradedOnly ? undefined : "page"}
        >
          All
        </Link>
        <Link
          href="/admin/hld-calibration?filter=ungraded"
          aria-current={ungradedOnly ? "page" : undefined}
        >
          Not graded yet
        </Link>
      </nav>
      {saved ? <p role="status">Saved {saved}.</p> : null}
      <ul className="flex flex-col gap-3">
        {shown.map((c) => {
          const mine = grades.get(c.id) ?? {};
          const suggestion = currentSuggestion(c);
          const suggested = suggestion === "outdated" ? undefined : suggestion;
          const all =
            suggested !== undefined &&
            c.input.rubric.every((r) => suggested[r.id] !== undefined);
          return (
            <li key={c.id} id={c.id}>
              <Card className="flex flex-col gap-2 p-5 text-sm">
                <p className="font-semibold">
                  {c.id}{" "}
                  <span className="font-normal text-ink-muted">
                    {graded(c.id, c.input.rubric.length) ? "· graded" : ""}
                  </span>
                </p>
                {suggestion === "outdated" ? (
                  <p className="text-ink-muted">
                    Claude&apos;s suggestion is outdated: the design changed
                    after it was written, so it isn&apos;t shown.
                  </p>
                ) : null}
                <details>
                  <summary>The design</summary>
                  <JudgedDesign input={c.input} />
                </details>
                <form
                  action={gradeCandidateAction}
                  className="flex flex-col gap-3"
                >
                  <input type="hidden" name="id" value={c.id} />
                  {ungradedOnly ? (
                    <input type="hidden" name="filter" value="ungraded" />
                  ) : null}
                  {c.input.rubric.map((r) => {
                    const s = suggested?.[r.id];
                    return (
                      <div key={r.id} className="flex flex-col gap-1">
                        <label className="flex flex-col gap-1">
                          <span>
                            {r.criterion}
                            {mine[r.id] === undefined ? (
                              <span className="text-ink-muted">
                                {" "}
                                · not graded yet
                              </span>
                            ) : null}
                          </span>
                          <select
                            name={`level:${r.id}`}
                            defaultValue={mine[r.id] ?? 0}
                            className="self-start rounded-md border border-hairline p-1"
                          >
                            {LEVEL_OPTIONS.map((o, i) => (
                              <option key={o} value={i}>
                                {o}
                              </option>
                            ))}
                          </select>
                        </label>
                        {s === undefined ? null : (
                          <p className="flex flex-wrap items-center gap-2 text-ink-muted">
                            <span>
                              Suggested (AI): {s.level} — {s.reason}
                            </span>
                            <button
                              type="submit"
                              name="accept"
                              value={r.id}
                              className={SECONDARY}
                            >
                              Accept suggestion
                            </button>
                          </p>
                        )}
                      </div>
                    );
                  })}
                  <div className="flex flex-wrap gap-2">
                    <button type="submit" className={ACT}>
                      Save grades
                    </button>
                    {all ? (
                      <button
                        type="submit"
                        name="accept"
                        value={ACCEPT_ALL}
                        className={SECONDARY}
                      >
                        Accept all for this design
                      </button>
                    ) : null}
                  </div>
                </form>
              </Card>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
