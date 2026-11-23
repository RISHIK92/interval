import type { DB } from "@interval/db";
import { type Kysely, sql } from "kysely";
import type { HldWindows } from "../ports";

// P6-W42 (MATCH-7, Q-P6-06): HLD's ranked windows in Postgres, as LLD's
// (kysely-battle-windows.ts) with a pooled variant in place of a problem.
const RECLAIM_AFTER = "1 minute";
const ROOM_START = 25; // openskill's starting mu, before a first rated room

export function kyselyHldWindows(db: Kysely<DB>): HldWindows {
  return {
    register: async (windowAt, userId, battleMode) => {
      await db
        .insertInto("hld_window_registration")
        .values({
          window_at: windowAt,
          user_id: userId,
          battle_mode: battleMode,
        })
        .onConflict((c) =>
          c
            .columns(["window_at", "user_id"])
            .doUpdateSet({ battle_mode: battleMode })
            .where("hld_window_registration.match_id", "is", null),
        )
        .execute();
    },

    unregister: async (windowAt, userId) => {
      await db
        .deleteFrom("hld_window_registration")
        .where("window_at", "=", windowAt)
        .where("user_id", "=", userId)
        .where("match_id", "is", null)
        .execute();
    },

    registration: async (windowAt, userId) => {
      const row = await db
        .selectFrom("hld_window_registration")
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
      const fresh = await db
        .selectFrom("hld_window")
        .select(["family", "seed"])
        .where("window_at", "=", windowAt)
        .where("battle_mode", "=", battleMode)
        .executeTakeFirst();
      const variant = fresh ?? pick();
      // First at or after the start, or a stale claim that left players ungrouped.
      const claimed = await sql<{ family: string; seed: number }>`
        insert into hld_window (window_at, battle_mode, grouping_at, family, seed)
        values (${windowAt}, ${battleMode}, ${now}, ${variant.family}, ${variant.seed})
        on conflict (window_at, battle_mode) do update
          set grouping_at = excluded.grouping_at
          where hld_window.grouping_at < ${now}::timestamptz - ${RECLAIM_AFTER}::interval
            and exists (select 1 from hld_window_registration r
              where r.window_at = excluded.window_at and r.battle_mode = excluded.battle_mode
                and r.match_id is null)
        returning family, seed`.execute(db);
      const row = claimed.rows[0];
      if (row === undefined) return null;
      const players = await db
        .selectFrom("hld_window_registration as r")
        .leftJoin("hld_room_rating as rr", (join) =>
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
        variant: { family: row.family, seed: row.seed },
        players: players.map((p) => ({ userId: p.user_id, rating: p.rating })),
      };
    },

    extend: async (windowAt, battleMode, now) => {
      await db
        .updateTable("hld_window")
        .set({ grouping_at: now })
        .where("window_at", "=", windowAt)
        .where("battle_mode", "=", battleMode)
        .execute();
    },

    assign: async (windowAt, battleMode, matchId, userIds) => {
      await db
        .updateTable("hld_window_registration")
        .set({ match_id: matchId })
        .where("window_at", "=", windowAt)
        .where("battle_mode", "=", battleMode)
        .where("user_id", "in", userIds)
        .execute();
    },
  };
}
