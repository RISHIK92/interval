import { calibrationCandidates } from "@interval/hld";
import { hldJudgements } from "../../../server/container";
import { Card } from "../../ui/Card";
import { requireAdmin } from "../guard";
import { LEVEL_OPTIONS } from "../hld-grades";
import { JudgedDesign } from "../JudgedDesign";
import { ACT, ADMIN_MAIN } from "../style";
import { gradeCandidateAction } from "./actions";

export const dynamic = "force-dynamic";

// P6-W41 (CANVAS-6, AI-5, Q-P6-05): the calibration set, about 50 designs for the owner
// to grade. `eval-hld-judge` (the worker) measures the judge's agreement with these
// grades; an injection design's notes try to steer the judge, and should be graded on
// the design alone.
export default async function HldCalibrationPage(props: {
  searchParams: Promise<{ saved?: string }>;
}) {
  await requireAdmin();
  const { saved } = await props.searchParams;
  const candidates = calibrationCandidates();
  const grades = await hldJudgements().calibrationGrades();
  const done = candidates.filter(
    (c) => Object.keys(grades.get(c.id) ?? {}).length === c.input.rubric.length,
  ).length;
  return (
    <main className={ADMIN_MAIN}>
      <h1 className="text-title">HLD judge calibration</h1>
      <p className="text-sm text-ink-muted">
        {done} of {candidates.length} designs graded. Run{" "}
        <code>python -m interval_jobs eval-hld-judge --model M</code> to measure
        the judge against them (it calls the model).
      </p>
      {saved ? <p role="status">Saved {saved}.</p> : null}
      <ul className="flex flex-col gap-3">
        {candidates.map((c) => {
          const mine = grades.get(c.id) ?? {};
          return (
            <li key={c.id} id={c.id}>
              <Card className="flex flex-col gap-2 p-5 text-sm">
                <p className="font-semibold">
                  {c.id}{" "}
                  <span className="font-normal text-ink-muted">
                    {Object.keys(mine).length === c.input.rubric.length
                      ? "· graded"
                      : ""}
                  </span>
                </p>
                <details>
                  <summary>The design</summary>
                  <JudgedDesign input={c.input} />
                </details>
                <form
                  action={gradeCandidateAction}
                  className="flex flex-col gap-2"
                >
                  <input type="hidden" name="id" value={c.id} />
                  {c.input.rubric.map((r) => (
                    <label key={r.id} className="flex flex-col gap-1">
                      {r.criterion}
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
                  ))}
                  <button type="submit" className={`self-start ${ACT}`}>
                    Save grades
                  </button>
                </form>
              </Card>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
