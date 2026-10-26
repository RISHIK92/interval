import { CHIPS, parseChip } from "../../../server/chips";
import { rankingInspection } from "../../../server/container";
import type { RankingSetting, ScoreBreakdown } from "../../../server/ports";
import { requireAdmin } from "../guard";
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
    <main>
      <h1>Ranking</h1>
      {params.saved === "1" ? (
        <p role="status">Saved. Your feed recomputes shortly.</p>
      ) : params.saved === "same" ? (
        <p role="status">No change: that was already the value.</p>
      ) : null}
      {params.error !== undefined && params.error in ERRORS ? (
        <p role="alert">{ERRORS[params.error]}</p>
      ) : null}
      <nav aria-label="Break length">
        <ul>
          {CHIPS.map((c) => (
            <li key={c}>
              {c === chip ? (
                <strong>{c} min</strong>
              ) : (
                <a href={`/admin/ranking?chip=${c}`}>{c} min</a>
              )}
            </li>
          ))}
        </ul>
      </nav>
      <h2>Your feed, {chip} min</h2>
      {entries.length === 0 ? (
        <p>No entries yet.</p>
      ) : (
        <table>
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
                    signals={weights.map((w) => w.key.slice("weight.".length))}
                  />
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <h2>Settings</h2>
      {settings.map((setting) => (
        <form key={setting.key} action={saveRankingSettingAction}>
          <input type="hidden" name="key" value={setting.key} />
          <input type="hidden" name="chip" value={chip} />
          <label>
            {setting.key} ({setting.note}){" "}
            <input
              type="number"
              name="value"
              step="any"
              required
              defaultValue={setting.value}
            />
          </label>{" "}
          <button type="submit">Save</button>
        </form>
      ))}
    </main>
  );
}
