import type { DB } from "@interval/db";
import { type Kysely, sql } from "kysely";
import { z } from "zod";
import { type BattleQuestions, INTERVIEWER_QUESTIONS } from "../ports";

// P5-W33 (§6.2, Q-P5-13): interviewer questions in Postgres. A battle runs 45 minutes;
// one an hour old is over even if its result never came.
// As battle_question's check allows.
const Status = z.enum(["pending", "answered", "unavailable"]);

const inTransaction = <T>(
  db: Kysely<DB>,
  body: (trx: Kysely<DB>) => Promise<T>,
): Promise<T> => (db.isTransaction ? body(db) : db.transaction().execute(body));

export function kyselyBattleQuestions(db: Kysely<DB>): BattleQuestions {
  return {
    ask: (matchId, userId, question) =>
      inTransaction(db, async (trx) => {
        // One player's questions in a battle one at a time: the limit holds when
        // several are sent at once.
        await sql`select pg_advisory_xact_lock(hashtext(${`${matchId}:${userId}`}))`.execute(
          trx,
        );
        const open = await sql<{ asked: number }>`
          select (select count(*)::int from battle_question q
                  where q.match_id = m.id and q.user_id = ${userId}) as asked
          from game_match m
          join game_match_player p on p.match_id = m.id and p.user_id = ${userId}
          where m.id = ${matchId}::uuid and m.mode = 'battle' and m.league = 'ai'
            and m.finished_at is null and m.created_at > now() - interval '1 hour'`.execute(
          trx,
        );
        const row = open.rows[0];
        if (row === undefined) return null;
        if (row.asked >= INTERVIEWER_QUESTIONS) return "limit";
        const { id } = await trx
          .insertInto("battle_question")
          .values({ match_id: matchId, user_id: userId, question })
          .returning("id")
          .executeTakeFirstOrThrow();
        return { id };
      }),

    fail: async (questionId) => {
      await db
        .updateTable("battle_question")
        .set({ status: "unavailable", answered_at: sql<Date>`now()` })
        .where("id", "=", questionId)
        .where("status", "=", "pending")
        .execute();
    },

    list: async (matchId, userId) =>
      (
        await db
          .selectFrom("battle_question")
          .select(["id", "question", "status", "answer"])
          .where("match_id", "=", matchId)
          .where("user_id", "=", userId)
          .orderBy("id")
          .execute()
      ).map((r) => ({
        id: r.id,
        question: r.question,
        status: Status.parse(r.status),
        answer: r.answer,
      })),
  };
}
