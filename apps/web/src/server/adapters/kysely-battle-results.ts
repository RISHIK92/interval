import type { DB } from "@interval/db";
import { type Kysely, sql } from "kysely";
import { z } from "zod";
import { type AdminDisputes, type BattleResults, DISPUTE_DAYS } from "../ports";

// P5-W35 (§6.5, DB-6; Q-P5-14, Q-P5-22): a battle's results in Postgres.
const ReviewStatus = z.enum(["pending", "ready", "unavailable"]);

export function kyselyBattleResults(db: Kysely<DB>): BattleResults {
  // The match, when the user played it.
  const seat = (matchId: string, userId: string) =>
    db
      .selectFrom("game_match as m")
      .innerJoin("game_match_player as p", "p.match_id", "m.id")
      .select([
        "m.problem_slug",
        "m.league",
        "m.finished_at",
        sql<boolean>`coalesce(m.finished_at > now() - make_interval(days => ${DISPUTE_DAYS}), false)`.as(
          "dispute_open",
        ),
      ])
      .where("m.id", "=", matchId)
      .where("m.mode", "=", "battle")
      .where("p.user_id", "=", userId)
      .executeTakeFirst();

  return {
    of: async (matchId, userId) => {
      const match = await seat(matchId, userId);
      if (match?.problem_slug == null) return null;
      const players = await db
        .selectFrom("game_match_player as p")
        .innerJoin("app_user as u", "u.id", "p.user_id")
        .leftJoin("player_username as n", "n.user_id", "p.user_id")
        .select([
          "p.user_id",
          sql<string>`coalesce(n.username, u.name)`.as("name"),
          "p.total",
          "p.time_ms",
          "p.abandoned",
          "p.place",
        ])
        .where("p.match_id", "=", matchId)
        .orderBy(sql`p.place nulls last`)
        .orderBy("p.user_id")
        .execute();
      const change = await sql<{ change: number }>`
        select rating_after - rating_before as change from battle_rating_history
        where match_id = ${matchId} and user_id = ${userId}
        union all
        select mu_after - mu_before from room_rating_history
        where match_id = ${matchId} and user_id = ${userId}`.execute(db);
      const best = await db
        .selectFrom("battle_best_submission")
        .select("key")
        .where("match_id", "=", matchId)
        .where("user_id", "=", userId)
        .executeTakeFirst();
      const review = await db
        .selectFrom("battle_review")
        .select(["status", "review"])
        .where("match_id", "=", matchId)
        .where("user_id", "=", userId)
        .executeTakeFirst();
      const disputed = await db
        .selectFrom("battle_dispute")
        .select("match_id")
        .where("match_id", "=", matchId)
        .where("user_id", "=", userId)
        .executeTakeFirst();
      return {
        problem: match.problem_slug,
        league: match.league === "ai" ? "ai" : "human",
        finishedAt: match.finished_at,
        standings: players.map((p) => ({
          userId: p.user_id,
          name: p.name,
          total: p.total ?? 0,
          timeMs: p.time_ms === null ? null : Number(p.time_ms),
          abandoned: p.abandoned ?? false,
          place: p.place,
          you: p.user_id === userId,
        })),
        change: change.rows[0]?.change ?? null,
        hasBest: best !== undefined,
        review:
          review === undefined
            ? null
            : {
                status: ReviewStatus.parse(review.status),
                review: review.review,
              },
        disputed: disputed !== undefined,
        disputeOpen: match.dispute_open,
      };
    },

    frames: async (matchId, userId) => {
      const match = await seat(matchId, userId);
      if (match?.finished_at == null) return null;
      return (
        await db
          .selectFrom("battle_snapshot")
          .select(["user_id", "taken_at", "key"])
          .where("match_id", "=", matchId)
          .orderBy("taken_at")
          .orderBy("key")
          .execute()
      ).map((r) => ({ userId: r.user_id, takenAt: r.taken_at, key: r.key }));
    },

    requestReview: async (matchId, userId) => {
      const match = await seat(matchId, userId);
      if (match?.finished_at == null) return null;
      const best = await db
        .selectFrom("battle_best_submission")
        .select("key")
        .where("match_id", "=", matchId)
        .where("user_id", "=", userId)
        .executeTakeFirst();
      if (best === undefined) return "no_code";
      const made = await db
        .insertInto("battle_review")
        .values({ match_id: matchId, user_id: userId })
        .onConflict((c) => c.doNothing())
        .returning("match_id")
        .executeTakeFirst();
      if (made !== undefined) return "requested";
      const was = await db
        .selectFrom("battle_review")
        .select("status")
        .where("match_id", "=", matchId)
        .where("user_id", "=", userId)
        .executeTakeFirst();
      return was?.status === "pending" ? "pending" : "exists";
    },

    dropReview: async (matchId, userId) => {
      await db
        .deleteFrom("battle_review")
        .where("match_id", "=", matchId)
        .where("user_id", "=", userId)
        .where("status", "=", "pending")
        .execute();
    },

    dispute: async (matchId, userId, reason) => {
      const match = await seat(matchId, userId);
      if (match?.finished_at == null) return null;
      if (!match.dispute_open) return "late";
      const made = await db
        .insertInto("battle_dispute")
        .values({ match_id: matchId, user_id: userId, reason })
        .onConflict((c) => c.doNothing())
        .returning("match_id")
        .executeTakeFirst();
      return made === undefined ? "exists" : "disputed";
    },
  };
}

export function kyselyAdminDisputes(db: Kysely<DB>): AdminDisputes {
  return {
    pending: async () =>
      (
        await db
          .selectFrom("battle_dispute as d")
          .innerJoin("app_user as u", "u.id", "d.user_id")
          .leftJoin("player_username as n", "n.user_id", "d.user_id")
          .select([
            "d.match_id",
            "d.user_id",
            sql<string>`coalesce(n.username, u.name)`.as("player"),
            "d.reason",
            "d.created_at",
          ])
          .where("d.decision", "is", null)
          .orderBy("d.created_at")
          .execute()
      ).map((r) => ({
        matchId: r.match_id,
        userId: r.user_id,
        player: r.player,
        reason: r.reason,
        createdAt: r.created_at,
      })),

    rate: async () => {
      const row = await sql<{ finished: number; disputed: number }>`
        select count(*)::int as finished,
               count(*) filter (where exists (
                 select 1 from battle_dispute d where d.match_id = m.id))::int
                 as disputed
        from game_match m
        where m.mode = 'battle' and m.finished_at > now() - interval '30 days'`.execute(
        db,
      );
      return row.rows[0] ?? { finished: 0, disputed: 0 };
    },

    decide: async (matchId, userId, decision, note, adminUserId) => {
      const done = await db
        .updateTable("battle_dispute")
        .set({
          decision,
          note,
          decided_at: sql<Date>`now()`,
          decided_by: adminUserId,
        })
        .where("match_id", "=", matchId)
        .where("user_id", "=", userId)
        .where("decision", "is", null)
        .executeTakeFirst();
      return done.numUpdatedRows > 0n;
    },
  };
}
