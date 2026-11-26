import type { LeagueTier } from "@interval/db";
import type { Messages } from "@interval/db/messages";
import { offset, zoned } from "./battle-windows";
import type { JobQueue, LeagueRow } from "./ports";

// ADR-0045: weekly leagues. The worker scores and moves players (workers/jobs
// leagues.py); this is only how the web shows a week: when it runs, and what a
// member's week reads as.

// Bottom up, as the database orders them.
export const TIERS = [
  "bronze",
  "silver",
  "gold",
  "sapphire",
  "ruby",
  "diamond",
] as const satisfies readonly LeagueTier[];

export const TIER_NAMES: Record<LeagueTier, string> = {
  bronze: "Bronze",
  silver: "Silver",
  gold: "Gold",
  sapphire: "Sapphire",
  ruby: "Ruby",
  diamond: "Diamond",
};

export const tierAbove = (tier: LeagueTier): LeagueTier | null =>
  TIERS[TIERS.indexOf(tier) + 1] ?? null;
export const tierBelow = (tier: LeagueTier): LeagueTier | null =>
  TIERS[TIERS.indexOf(tier) - 1] ?? null;

const DAY_MS = 86_400_000;

// The week now, in the leagues' zone (BATTLE_WINDOW_TIME_ZONE, as the worker's): its
// Monday (YYYY-MM-DD), when the next Monday begins, and when today began.
export function leagueWeek(
  now: Date,
  timeZone: string,
): { start: string; endsAt: Date; todayFrom: Date } {
  const local = new Date(now.getTime() + offset(now.getTime(), timeZone));
  const [y, m, d] = [
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate(),
  ];
  const sinceMonday = (local.getUTCDay() + 6) % 7;
  const monday = new Date(Date.UTC(y, m, d - sinceMonday));
  return {
    start: monday.toISOString().slice(0, 10),
    endsAt: zoned(y, m, d - sinceMonday + 7, 0, timeZone),
    todayFrom: zoned(y, m, d, 0, timeZone),
  };
}

// Whole days and hours to go (the design's "2d 6h").
export function timeLeft(
  now: Date,
  endsAt: Date,
): { days: number; hours: number } {
  const hours = Math.max(
    0,
    Math.floor((endsAt.getTime() - now.getTime()) / (DAY_MS / 24)),
  );
  return { days: Math.floor(hours / 24), hours: hours % 24 };
}

const counted = (n: number, one: string, many: string) =>
  `${String(n)} ${n === 1 ? one : many}`;

// The design's This week: "14 matches · 1 battle", and the player's own "+41 today".
export function weekSoFar(
  row: Pick<LeagueRow, "matches" | "battles" | "checkpoints" | "today">,
  mine: boolean,
): string {
  const parts = [
    row.matches > 0 ? counted(row.matches, "match", "matches") : null,
    row.battles > 0 ? counted(row.battles, "battle", "battles") : null,
    row.checkpoints > 0
      ? counted(row.checkpoints, "checkpoint", "checkpoints")
      : null,
    mine && row.today > 0 ? `+${String(row.today)} today` : null,
  ];
  return parts.filter((p) => p !== null).join(" · ");
}

// The worker's league_points stage scores a source once per player (LOAD-5), so a
// caller may queue a source again until it knows it went; its key keeps a repeat to
// one job.
export function queueLeaguePoints(
  queue: JobQueue,
  sourceKind: Messages["league_points"]["source_kind"],
  sourceId: string,
): Promise<void> {
  return queue.enqueue(
    "league_points",
    { source_kind: sourceKind, source_id: sourceId },
    { idempotencyKey: `league-${sourceKind.replace("_", "-")}-${sourceId}` },
  );
}
