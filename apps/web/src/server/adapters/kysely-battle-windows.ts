import type { DB } from "@interval/db";
import { type Kysely, sql } from "kysely";
import type { BattleWindows } from "../ports";

// P5-W32 (§6.6, MATCH-7; Q-P5-12, Q-P5-19): ranked battle windows in Postgres; P5-W33
// (Q-P5-20): registration and grouping per battle mode, at the same times.
const RECLAIM_AFTER = "1 minute";
const ROOM_START = 25; // openskill's starting mu, before a first rated room

export function kyselyBattleWindows(db: Kysely<DB>): BattleWindows {
  return {
    register: async (windowAt, userId, remindAt, battleMode) => {
      await db
        .insertInto("battle_window_registration")
        .values({
          window_at: windowAt,
          user_id: userId,
          remind_at: remindAt,
          battle_mode: battleMode,
        })
        // Registering again (the other battle mode) moves the player, until grouped.
        .onConflict((c) =>
          c
            .columns(["window_at", "user_id"])
            .doUpdateSet({ battle_mode: battleMode })
            .where("battle_window_registration.match_id", "is", null),
        )
        .execute();
    },

    unregister: async (windowAt, userId) => {
      await db
        .deleteFrom("battle_window_registration")
        .where("window_at", "=", windowAt)
        .where("user_id", "=", userId)
        .where("match_id", "is", null)
        .execute();
    },

    registration: async (windowAt, userId) => {
      const row = await db
        .selectFrom("battle_window_registration")
        .select(["match_id", "battle_mode"])
        .where("window_at", "=", windowAt)
        .where("user_id", "=", userId)
        .executeTakeFirst();
      return row === undefined
        ? null
        : {
            matchId: row.match_id,
            battleMode: row.battle_mode === "ai" ? "ai" : "human",
          };
    },

    claim: async (windowAt, battleMode, now, pick) => {
      // A problem only when this caller may be the first: picked outside the claim.
      const fresh = await sql<{ problem_slug: string }>`
        select problem_slug from battle_window
        where window_at = ${windowAt} and battle_mode = ${battleMode}`.execute(
        db,
      );
      const problem = fresh.rows[0]?.problem_slug ?? (await pick());
      // First at or after the start, or a stale claim that left players ungrouped.
      const claimed = await sql<{ problem_slug: string; first: boolean }>`
        insert into battle_window (window_at, battle_mode, grouping_at, problem_slug)
        values (${windowAt}, ${battleMode}, ${now}, ${problem})
        on conflict (window_at, battle_mode) do update
          set grouping_at = excluded.grouping_at
          where battle_window.grouping_at < ${now}::timestamptz - ${RECLAIM_AFTER}::interval
            and exists (select 1 from battle_window_registration r
              where r.window_at = excluded.window_at and r.battle_mode = excluded.battle_mode
                and r.match_id is null)
        returning problem_slug, (xmax = 0) as first`.execute(db);
      const row = claimed.rows[0];
      if (row === undefined) return null;
      const players = await db
        .selectFrom("battle_window_registration as r")
        .leftJoin("room_rating as rr", (join) =>
          join
            .onRef("rr.user_id", "=", "r.user_id")
            .onRef("rr.battle_mode", "=", "r.battle_mode"),
        )
        .select([
          "r.user_id",
          sql<number>`coalesce(rr.mu, ${ROOM_START})`.as("rating"),
        ])
        .where("r.window_at", "=", windowAt)
        .where("r.battle_mode", "=", battleMode)
        .where("r.match_id", "is", null)
        .orderBy("rating", "desc")
        .orderBy("r.registered_at")
        .execute();
      return {
        problem: row.problem_slug,
        players: players.map((p) => ({ userId: p.user_id, rating: p.rating })),
        // xmax = 0: inserted, not a stale claim retaken.
        first: row.first,
      };
    },

    extend: async (windowAt, battleMode, now) => {
      await db
        .updateTable("battle_window")
        .set({ grouping_at: now })
        .where("window_at", "=", windowAt)
        .where("battle_mode", "=", battleMode)
        .execute();
    },

    assign: async (windowAt, battleMode, matchId, userIds) => {
      await db
        .updateTable("battle_window_registration")
        .set({ match_id: matchId })
        .where("window_at", "=", windowAt)
        .where("battle_mode", "=", battleMode)
        .where("user_id", "in", userIds)
        .execute();
    },
  };
}
