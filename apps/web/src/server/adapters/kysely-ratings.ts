import type { DB } from "@interval/db";
import { type Kysely, sql } from "kysely";
import type { PlayerRatings } from "../ports";

// P3-W16-S01 (ADR-0034): the worker writes ratings; matchmaking reads them.
const START = 1500;

export function kyselyRatings(db: Kysely<DB>): PlayerRatings {
  return {
    of: async (userId) =>
      (
        await db
          .selectFrom("player_rating")
          .select("rating")
          .where("user_id", "=", userId)
          .executeTakeFirst()
      )?.rating ?? START,
    // P3-W18-S02 (§6.9): the confirmed fair-play penalties, as /admin/fair-play left them.
    adjustments: async (userId) =>
      (
        await db
          .selectFrom("fair_play_flag as f")
          .innerJoin("game_match as m", "m.id", "f.match_id")
          .select([
            "f.penalty",
            sql<Date>`coalesce(m.finished_at, f.created_at)`.as("played_at"),
          ])
          .where("f.user_id", "=", userId)
          .where("f.decision", "=", "penalized")
          .orderBy("f.decided_at", "desc")
          .execute()
      ).map((r) => ({ penalty: r.penalty ?? 0, playedAt: r.played_at })),
  };
}
