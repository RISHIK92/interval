import type { BattleMode } from "../../server/ports";

// MATCH-7: a ranked window's registration, as the lobbies make it. LLD's and HLD's
// windows share their times but are registered apart (Q-P6-06); POST registers in a
// battle mode (ADR-0047), DELETE takes it back, and either answers 409 once
// registration has closed.
const WINDOW_API = {
  lld: "/api/battle/window",
  hld: "/api/hld/window",
} as const;

export type RankedGame = keyof typeof WINDOW_API;

export async function setWindowRegistration(
  game: RankedGame,
  on: boolean,
  battleMode: BattleMode,
): Promise<boolean> {
  const res = await fetch(`${WINDOW_API[game]}?mode=${battleMode}`, {
    method: on ? "POST" : "DELETE",
    headers: { "content-type": "application/json" },
  });
  return res.ok;
}
