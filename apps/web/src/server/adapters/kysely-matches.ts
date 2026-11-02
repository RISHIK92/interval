import { randomUUID } from "node:crypto";
import type { DB } from "@interval/db";
import { type Kysely, sql } from "kysely";
import { LIVE_ROUNDS, type LiveRound, type Matches } from "../ports";
import { type BankQuestion, levelFor, pickRounds } from "../live-questions";
import { LIVE } from "./kysely-quizzes";

// ADR-0034: a player not yet rated counts as the starting rating (the worker's
// interval_jobs/ratings.py START).
const START_RATING = 1500;

// P3-W15-S02, S03 (ADR-0033, Q-P3-22): live matches, their players and their questions.
export function kyselyMatches(db: Kysely<DB>): Matches {
  // Kysely can't nest transactions: inside one (as the tests run), use it.
  const inTransaction = <T>(body: (trx: Kysely<DB>) => Promise<T>) =>
    db.isTransaction ? body(db) : db.transaction().execute(body);
  return {
    create: (serverId, players) =>
      inTransaction(async (trx) => {
        // MATCH-4 (P3-W16-S03): from what the two share, at their level.
        // shortcut: the whole live bank per match (about a thousand rows); narrow it
        // to the tiers' concepts in SQL once it passes some ten thousand.
        const { rows: bank } = await sql<BankQuestion>`
          select q.id::text as question, q.stem, q.options, q.correct,
                 q.difficulty as level,
                 coalesce(array_agg(c.id::text)
                   filter (where c.id is not null), '{}') as concepts
          from ${LIVE}
          left join question_concept qc on qc.question_id = q.id
          left join concept c on c.id = qc.concept_id and c.retired_at is null
          where q.status = 'live'
          group by q.id
        `.execute(trx);
        // Retired concepts never count: no question carries one (above).
        const known = await trx
          .selectFrom("concept_mastery as m")
          .innerJoin("concept as c", "c.id", "m.concept_id")
          .select(["m.user_id", "m.concept_id"])
          .where("m.user_id", "in", players)
          .where("c.retired_at", "is", null)
          .execute();
        const of = (userId: string) =>
          new Set(
            known.filter((k) => k.user_id === userId).map((k) => k.concept_id),
          );
        const [first = new Set<string>(), ...rest] = players.map(of);
        const shared = new Set(
          [...first].filter((c) => rest.every((other) => other.has(c))),
        );
        // Goal concepts as the solo sprint has them (user_goal_concepts, ADR-0015).
        const goals = new Set(
          (
            await sql<{ id: string }>`
              select g.concept_id::text as id
              from unnest(array[${sql.join(players)}]::text[]) u(id)
              cross join user_goal_concepts(u.id) g
            `.execute(trx)
          ).rows.map((r) => r.id),
        );
        const rated = new Map(
          (
            await trx
              .selectFrom("player_rating")
              .select(["user_id", "rating"])
              .where("user_id", "in", players)
              .execute()
          ).map((r) => [r.user_id, r.rating]),
        );
        const average =
          players.reduce(
            (sum, userId) => sum + (rated.get(userId) ?? START_RATING),
            0,
          ) / players.length;
        const rows: LiveRound[] = pickRounds(
          bank,
          { shared, goals },
          levelFor(average),
          LIVE_ROUNDS,
        ).map(({ question, stem, options, correct }) => ({
          question,
          stem,
          options,
          correct,
        }));
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

    serverFor: async (matchId, userId) => {
      const row = await db
        .selectFrom("game_match as m")
        .innerJoin("game_match_player as p", "p.match_id", "m.id")
        .select(["m.server_id", "p.played_as"])
        .where("m.id", "=", matchId)
        .where("p.user_id", "=", userId)
        .executeTakeFirst();
      return row === undefined
        ? null
        : { serverId: row.server_id, playedAs: row.played_as ?? userId };
    },
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
        match?.players.includes(userId) === true
          ? { serverId: match.serverId, playedAs: userId }
          : null,
      );
    },
  };
}
