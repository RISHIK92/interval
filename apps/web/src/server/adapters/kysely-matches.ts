import type { DB } from "@interval/db";
import type { Kysely } from "kysely";
import type { Matches } from "../ports";

// P3-W15-S02 (ADR-0033): live matches and their players.
export function kyselyMatches(db: Kysely<DB>): Matches {
  return {
    serverFor: async (matchId, userId) =>
      (
        await db
          .selectFrom("game_match as m")
          .innerJoin("game_match_player as p", "p.match_id", "m.id")
          .select("m.server_id")
          .where("m.id", "=", matchId)
          .where("p.user_id", "=", userId)
          .executeTakeFirst()
      )?.server_id ?? null,
  };
}

// The in-memory fake (ADR-0012), over the given matches.
export function memoryMatches(
  matches: Map<string, { serverId: number; players: string[] }>,
): Matches {
  return {
    serverFor: (matchId, userId) => {
      const match = matches.get(matchId);
      return Promise.resolve(
        match?.players.includes(userId) === true ? match.serverId : null,
      );
    },
  };
}
