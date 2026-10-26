import { CHIPS, parseChip } from "../../../server/chips";
import { rankingInspection } from "../../../server/container";
import type { RankingSetting, ScoreBreakdown } from "../../../server/ports";
import { Card } from "../../ui/Card";
import { FIELD } from "../../ui/field";
import { requireAdmin } from "../guard";
import { ACT, ADMIN_MAIN, TABLE } from "../style";
import { saveRankingSettingAction } from "./actions";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  "out-of-range": "That value is outside its allowed range.",
  "unknown-key": "That setting doesn't exist.",
};

const n = (value: number) => value.toFixed(2);

// One rule's part of a score: its value, the weight it was scored with, the product.
function part(breakdown: ScoreBreakdown, signal: string): string {
  const value = breakdown.values[signal] ?? 0;
  const weight = breakdown.weights[signal] ?? 0;
  return `${n(value)} × ${n(weight)} = ${n(breakdown.weighted[signal] ?? 0)}`;
}

function total({ weighted, penalty }: ScoreBreakdown): string {
  return n(Object.values(weighted).reduce((a, b) => a + b, 0) - penalty);
}

function BreakdownCells(props: {
  breakdown: ScoreBreakdown;
  signals: string[];
}) {
  const { breakdown } = props;
  return (
    <>
      {props.signals.map((signal) => (
        <td key={signal}>{part(breakdown, signal)}</td>
      ))}
      <td>{breakdown.penalty > 0 ? `−${n(breakdown.penalty)}` : "0"}</td>
      <td>{total(breakdown)}</td>
    </>
  );
}

// REC-2, P1-W6-S01: the owner's own feed with every score broken down by rule, and the
// ranking_config values to tune it. A change recomputes the owner's feed now and
// everyone else's at their next hourly recompute.
export default async function RankingPage(props: {
  searchParams: Promise<{ chip?: string; saved?: string; error?: string }>;
}) {
  const actor = await requireAdmin();
  const params = await props.searchParams;
  const chip = parseChip(params.chip) ?? CHIPS[0];
  const ranking = rankingInspection();
  const [entries, settings] = await Promise.all([
    ranking.entries(actor.userId, chip),
    ranking.settings(),
  ]);
  const weights: RankingSetting[] = settings.filter((s) =>
    s.key.startsWith("weight."),
  );
  return (
    <main className={ADMIN_MAIN}>
      <h1 className="text-title">Ranking</h1>
      {params.saved === "1" || params.saved === "same" ? (
        <Card className="px-4 py-3 text-sm">
          <p role="status">
            {params.saved === "1"
              ? "Saved. Your feed recomputes shortly."
              : "No change: that was already the value."}
          </p>
        </Card>
      ) : null}
      {params.error !== undefined && params.error in ERRORS ? (
        <Card className="px-4 py-3 text-sm">
          <p role="alert" className="text-wrong">
            {ERRORS[params.error]}
          </p>
        </Card>
      ) : null}
      <nav aria-label="Break length">
        <ul className="flex gap-1 text-sm">
          {CHIPS.map((c) => (
            <li key={c}>
              {c === chip ? (
                <strong className="block rounded-xl bg-ink px-3 py-1.5 text-page">
                  {c} min
                </strong>
              ) : (
                <a
                  href={`/admin/ranking?chip=${c}`}
                  className="block rounded-xl border border-hairline px-3 py-1.5"
                >
                  {c} min
                </a>
              )}
            </li>
          ))}
        </ul>
      </nav>
      <h2 className="text-section">Your feed, {chip} min</h2>
      {entries.length === 0 ? (
        <p className="text-sm text-ink-muted">No entries yet.</p>
      ) : (
        // Scrolls within itself so the header row stays in view.
        <div className="max-h-[70vh] overflow-auto rounded-xl border border-hairline">
          <table className={TABLE}>
            <thead>
              <tr>
                <th>#</th>
                <th>Entry</th>
                <th>Top signal</th>
                {weights.map((w) => (
                  <th key={w.key}>{w.key.slice("weight.".length)}</th>
                ))}
                <th>Penalty</th>
                {/* Rank comes after diversity (MMR) and exploration, so scores
                  don't fall steadily down the table. */}
                <th>Score (before diversity)</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.rank}>
                  <td>{entry.rank}</td>
                  <td>
                    {entry.sectionTitle ?? entry.articleTitle}
                    {entry.sectionTitle === null ? " (whole article)" : ""}
                    {" — "}
                    {entry.sourceName}
                    {entry.explored
                      ? ` (explored: ${entry.explored.kind} ${entry.explored.arm})`
                      : ""}
                  </td>
                  <td>{entry.topSignal}</td>
                  {entry.breakdown === null ? (
                    <td colSpan={weights.length + 2}>
                      No breakdown yet: computed before inspection existed.
                    </td>
                  ) : (
                    <BreakdownCells
                      breakdown={entry.breakdown}
                      signals={weights.map((w) =>
                        w.key.slice("weight.".length),
                      )}
                    />
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <h2 className="text-section">Settings</h2>
      <div className="divide-y divide-hairline border-y border-hairline">
        {settings.map((setting) => (
          <form
            key={setting.key}
            action={saveRankingSettingAction}
            className="flex items-end gap-3 py-3 text-sm"
          >
            <input type="hidden" name="key" value={setting.key} />
            <input type="hidden" name="chip" value={chip} />
            <label className="flex-1">
              <span className="font-semibold">{setting.key}</span>{" "}
              <span className="text-ink-muted">({setting.note})</span>
              <input
                type="number"
                name="value"
                step="any"
                required
                defaultValue={setting.value}
                className={`${FIELD} max-w-48 tabular-nums`}
              />
            </label>
            <button type="submit" className={ACT}>
              Save
            </button>
          </form>
        ))}
      </div>
    </main>
  );
}
