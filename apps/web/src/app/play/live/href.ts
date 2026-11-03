import type { GameMode } from "../../../server/ports";

// A live match's screen, by its mode; with `match`, joining that match (P3-W17-S03).
export function liveHref(mode: GameMode, match?: string): string {
  const path = `/play/live/${mode === "sprint" ? "sprint" : "fastest-finger"}`;
  return match === undefined
    ? path
    : `${path}?match=${encodeURIComponent(match)}`;
}
