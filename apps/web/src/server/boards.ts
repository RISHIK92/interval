// P3-W14-S06 (§6.7; owner, 2026-11-02): what /play/boards can show.
export const GAMES = ["daily", "sprint", "estimation"] as const;
export const SCOPES = [
  "global",
  "country",
  "university",
  "friends",
  "universities",
] as const;
export const PERIODS = ["current", "previous"] as const;
export type Game = (typeof GAMES)[number];
export type Period = (typeof PERIODS)[number];

const DAY_MS = 86_400_000;

// The board's name as P3-W14-S01 makes it in SQL: the UTC day for the daily challenge,
// the ISO week (UTC) for sprints and estimation rounds; or the day or week before.
export function boardName(game: Game, period: Period, now: Date): string {
  if (game === "daily") {
    const day = new Date(now.getTime() - (period === "previous" ? DAY_MS : 0));
    return `daily:${day.toISOString().slice(0, 10)}`;
  }
  const at = new Date(now.getTime() - (period === "previous" ? 7 * DAY_MS : 0));
  // ISO 8601: the week's Thursday decides its year; week 1 holds the first Thursday.
  const thursday = new Date(
    Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()) +
      (3 - ((at.getUTCDay() + 6) % 7)) * DAY_MS,
  );
  const year = thursday.getUTCFullYear();
  const week =
    Math.floor((thursday.getTime() - Date.UTC(year, 0, 1)) / (7 * DAY_MS)) + 1;
  return `${game}:${String(year)}-W${String(week).padStart(2, "0")}`;
}

// A guest has no username (ADR-0029; owner, 2026-11-02): "Guest" and four digits from
// its id, the same on every board while it stays a guest.
export function guestLabel(userId: string): string {
  let hash = 0x811c9dc5; // FNV-1a, 32-bit
  for (let i = 0; i < userId.length; i += 1) {
    hash ^= userId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `Guest ${String(hash % 10_000).padStart(4, "0")}`;
}
