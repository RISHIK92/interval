import type { DB } from "@interval/db";
import { type Kysely, sql } from "kysely";
import type { BattleSnapshots } from "../ports";

// P5-W31-S04b (§6.9, Q-P5-17). A battle runs 45 minutes (Q-P5-15): a match an hour old
// is over even if its result never came. Snapshots are every 30 s; a little under that
// allows for timers.
const BATTLE_OPEN = "1 hour";
const SNAPSHOT_GAP_S = 25;

export function kyselyBattleSnapshots(db: Kysely<DB>): BattleSnapshots {
  return {
    claim: async (matchId, userId, language, at) => {
      const key = `battle-snapshots/${matchId}/${userId}/${at.toISOString()}.json`;
      // One statement: the player, the open battle and the gap are checked as it's
      // written; posts racing past the gap check meet the slot's unique key.
      const slot = Math.floor(at.getTime() / 1000 / SNAPSHOT_GAP_S);
      const row = await sql<{ key: string }>`
        insert into battle_snapshot (match_id, user_id, taken_at, language, key, slot)
        select ${matchId}::uuid, ${userId}, ${at}, ${language}, ${key}, ${slot}
        where exists (
            select 1 from game_match m
            join game_match_player p on p.match_id = m.id
            where m.id = ${matchId}::uuid and p.user_id = ${userId}
              and m.mode = 'battle' and m.finished_at is null
              and m.created_at > ${at}::timestamptz - ${BATTLE_OPEN}::interval)
          and not exists (
            select 1 from battle_snapshot s
            where s.match_id = ${matchId}::uuid and s.user_id = ${userId}
              and s.taken_at > ${at}::timestamptz - make_interval(secs => ${SNAPSHOT_GAP_S}))
        on conflict do nothing
        returning key`.execute(db);
      return row.rows[0]?.key ?? null;
    },

    forFlag: async (flagId) => {
      const flag = await db
        .selectFrom("fair_play_flag as f")
        .innerJoin("app_user as u", "u.id", "f.user_id")
        .leftJoin("player_username as n", "n.user_id", "f.user_id")
        .select([
          "f.match_id",
          "f.user_id",
          sql<string>`coalesce(n.username, u.name)`.as("player"),
        ])
        .where("f.id", "=", flagId)
        .executeTakeFirst();
      if (flag === undefined) return null;
      const rows = await db
        .selectFrom("battle_snapshot")
        .select(["taken_at", "language", "key"])
        .where("match_id", "=", flag.match_id)
        .where("user_id", "=", flag.user_id)
        .orderBy("taken_at")
        .execute();
      return {
        player: flag.player,
        snapshots: rows.map((r) => ({
          takenAt: r.taken_at,
          language: r.language,
          key: r.key,
        })),
      };
    },
  };
}
