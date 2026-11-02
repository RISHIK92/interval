import { randomUUID } from "node:crypto";
import type { DB } from "@interval/db";
import { type Kysely, sql } from "kysely";
import { LIVE_ROUNDS, type LiveRound, type Matches } from "../ports";
import { LIVE } from "./kysely-quizzes";

// P3-W15-S02, S03 (ADR-0033, Q-P3-22): live matches, their players and their questions.
export function kyselyMatches(db: Kysely<DB>): Matches {
  // Kysely can't nest transactions: inside one (as the tests run), use it.
  const inTransaction = <T>(body: (trx: Kysely<DB>) => Promise<T>) =>
    db.isTransaction ? body(db) : db.transaction().execute(body);
  return {
    create: (serverId, players) =>
      inTransaction(async (trx) => {
        const { rows } = await sql<LiveRound>`
          select q.id::text as question, q.stem, q.options, q.correct
          from ${LIVE}
          where q.status = 'live'
          order by random()
          limit ${LIVE_ROUNDS}
        `.execute(trx);
        if (rows.length < LIVE_ROUNDS) return null;
        const { id } = await trx
          .insertInto("game_match")
          .values({ server_id: serverId })
          .returning("id")
          .executeTakeFirstOrThrow();
        await trx
          .insertInto("game_match_player")
          .values(players.map((user_id) => ({ match_id: id, user_id })))
          .execute();
        await trx
          .insertInto("game_match_question")
          .values(
            rows.map((r, i) => ({
              match_id: id,
              round: i + 1,
              question_id: r.question,
            })),
          )
          .execute();
        return { id, serverId, players, rounds: rows };
      }),

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

// The in-memory fake (ADR-0012), over the given matches and a bank of live questions.
export function memoryMatches(
  matches: Map<string, { serverId: number; players: string[] }>,
  bank: LiveRound[] = [],
): Matches {
  return {
    create: (serverId, players) => {
      if (bank.length < LIVE_ROUNDS) return Promise.resolve(null);
      const id = randomUUID();
      matches.set(id, { serverId, players });
      return Promise.resolve({
        id,
        serverId,
        players,
        rounds: bank.slice(0, LIVE_ROUNDS),
      });
    },
    serverFor: (matchId, userId) => {
      const match = matches.get(matchId);
      return Promise.resolve(
        match?.players.includes(userId) === true ? match.serverId : null,
      );
    },
  };
}
