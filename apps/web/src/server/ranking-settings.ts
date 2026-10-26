import { randomUUID } from "node:crypto";
import type { JobQueue, RankingInspection } from "./ports";
import { queueRecompute } from "./recompute";

// The range each ranking_config key takes: the same the worker checks when it loads
// the table (RankingConfig.from_rows), so a value saved here never stops ranking.
type Limit = (value: number) => boolean;
const atLeastZero: Limit = (v) => v >= 0;
const LIMITS: [RegExp, Limit][] = [
  // A negative weight or penalty would reverse what its rule means.
  [/^(weight|penalty)\.[a-z_]+$/, atLeastZero],
  [/^freshness\.half_life_days$/, (v) => v > 0],
  [/^mmr\.lambda$/, (v) => v <= 1 && v >= 0],
  [/^explore\.share$/, (v) => v <= 0.5 && v >= 0],
  [/^cap\.per_source$/, (v) => Number.isInteger(v) && v >= 1],
];

export type SaveSetting =
  | { ok: true; changed: boolean }
  | { ok: false; error: "unknown-key" | "out-of-range" };

// P1-W6-S01: the owner changes a ranking weight; their own feed recomputes at once to
// show it, and everyone else's at their next hourly recompute.
export async function saveRankingSetting(
  ranking: RankingInspection,
  queue: JobQueue,
  userId: string,
  key: string,
  raw: string,
): Promise<SaveSetting> {
  const limit = LIMITS.find(([pattern]) => pattern.test(key))?.[1];
  if (limit === undefined) return { ok: false, error: "unknown-key" };
  const value = raw.trim() === "" ? Number.NaN : Number(raw);
  if (!Number.isFinite(value) || !limit(value)) {
    return { ok: false, error: "out-of-range" };
  }
  const result = await ranking.setSetting(key, value);
  if (result === "missing") return { ok: false, error: "unknown-key" };
  if (result === "changed") {
    await queueRecompute(
      queue,
      userId,
      `ranking-${userId}-${randomUUID()}`,
      "feed: recompute after a ranking change not queued",
    );
  }
  return { ok: true, changed: result === "changed" };
}
