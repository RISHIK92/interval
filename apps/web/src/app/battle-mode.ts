import type { BattleMode } from "../server/ports";

// ADR-0047: a battle mode's name wherever the UI shows one, as the glossary gives it.
export const BATTLE_MODE_NAMES: Record<BattleMode, string> = {
  human: "Human mode",
  ai: "AI mode",
};
