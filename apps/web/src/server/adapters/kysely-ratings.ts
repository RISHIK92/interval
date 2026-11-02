import type { DB } from "@interval/db";
import type { Kysely } from "kysely";
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
  };
}
