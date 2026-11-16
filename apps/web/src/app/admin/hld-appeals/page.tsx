import { hldJudgements } from "../../../server/container";
import { Card } from "../../ui/Card";
import { requireAdmin } from "../guard";
import { LEVEL_OPTIONS } from "../hld-grades";
import { JudgedDesign } from "../JudgedDesign";
import { ACT, ADMIN_MAIN } from "../style";
import { resolveAppealAction } from "./actions";

export const dynamic = "force-dynamic";

// P6-W41 (CANVAS-6, Q-P6-05): appealed AI judgements, oldest first. The owner grades
// each criterion; the owner's levels replace the judge's, and the appeal joins the
// calibration set the judge's agreement is measured on.
export default async function HldAppealsPage(props: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  await requireAdmin();
  const { saved, error } = await props.searchParams;
  const [appeals, rate] = await Promise.all([
    hldJudgements().openAppeals(),
    hldJudgements().appealRate(new Date()),
  ]);
  return (
    <main className={ADMIN_MAIN}>
      <h1 className="text-title">HLD appeals</h1>
      <p className="text-sm text-ink-muted">
        Last 30 days: {rate.appealed} of {rate.judged} graded match results
        appealed
        {rate.judged > 0
          ? ` (${((100 * rate.appealed) / rate.judged).toFixed(1)}%; the goal is under 5%)`
          : ""}
        .
      </p>
      {saved ? <p role="status">Saved.</p> : null}
      {error === "resolved" ? (
        <p role="alert" className="text-wrong">
          That appeal was already resolved.
        </p>
      ) : null}
      {appeals.length === 0 ? (
        <p className="text-ink-muted">Nothing to review.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {appeals.map((a) => (
            <li key={a.id}>
              <Card className="flex flex-col gap-3 p-5 text-sm">
                <p>
                  <span className="font-semibold">{a.player}</span>
                  <span className="text-ink-muted">
                    {" "}
                    · {a.problemSlug} · appealed{" "}
                    {a.appealedAt?.toISOString().slice(0, 16)} UTC
                  </span>
                </p>
                <p className="whitespace-pre-wrap">{a.reason}</p>
                <JudgedDesign input={a.input} />
                <form
                  action={resolveAppealAction}
                  className="flex flex-col gap-2"
                >
                  <input type="hidden" name="id" value={a.id} />
                  {a.input.rubric.map((c) => (
                    <fieldset key={c.id} className="flex flex-col gap-1">
                      <legend>{c.criterion}</legend>
                      <p className="text-ink-muted">
                        The judge: {a.levels?.[c.id]?.level ?? "–"} ·{" "}
                        {a.levels?.[c.id]?.reason ?? ""}
                      </p>
                      <select
                        name={`level:${c.id}`}
                        defaultValue={a.levels?.[c.id]?.level ?? 0}
                        aria-label={`Level for ${c.id}`}
                        className="self-start rounded-md border border-hairline p-1"
                      >
                        {LEVEL_OPTIONS.map((o, i) => (
                          <option key={o} value={i}>
                            {o}
                          </option>
                        ))}
                      </select>
                      <input
                        name={`reason:${c.id}`}
                        maxLength={400}
                        aria-label={`Reason for ${c.id}`}
                        className="rounded-md border border-hairline p-1"
                      />
                    </fieldset>
                  ))}
                  <button type="submit" className={`self-start ${ACT}`}>
                    Re-grade
                  </button>
                </form>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
