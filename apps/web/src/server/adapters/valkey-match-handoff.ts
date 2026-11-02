import type { Redis } from "ioredis";
import type { MatchHandoff } from "../ports";

// P3-W15-S03 (Q-P3-22, ADR-0033): game:match:<id>, read by its game server
// (services/game/store.go). An hour is longer than any match; it then goes by itself.
const HANDOFF_SECONDS = 3600;

export function valkeyMatchHandoff(redis: Redis): MatchHandoff {
  return {
    put: async (match) => {
      const body = JSON.stringify({
        players: match.players,
        rounds: match.rounds.map((r) => ({
          ...r,
          question: Number(r.question),
        })),
      });
      await redis.set(`game:match:${match.id}`, body, "EX", HANDOFF_SECONDS);
    },
  };
}
