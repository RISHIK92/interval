import type { Streak } from "../server/ports";

// Q-P3-07: the streak as Home, Play and a shared card (P3-W13-S06) word it.
export const streakText = ({ days, freezes }: Streak): string | null =>
  days === 0
    ? null
    : `${days === 1 ? "1-day" : `${String(days)}-day`} streak${freezes > 0 ? " · a freeze held" : ""}`;
