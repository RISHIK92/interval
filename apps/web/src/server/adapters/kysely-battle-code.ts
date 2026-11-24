import type { DB } from "@interval/db";
import { type Kysely, sql } from "kysely";
import type { BattleCode } from "../ports";

// Q-WD-17 (owner, 2026-11-23): a battle player's code per language in Postgres. As a
// fair-play snapshot is (kysely-battle-snapshots.ts), saved only by a player of a battle
// still open: unfinished, and under an hour old (a battle runs 45 minutes, Q-P5-15).
const BATTLE_OPEN = "1 hour";
// The page saves a language about 2 s after its last edit: closer than this is a repeat.
const MIN_GAP = "1 second";

export function kyselyBattleCode(db: Kysely<DB>): BattleCode {
  return {
    save: async (matchId, userId, language, code, at) => {
      // One statement: the player and the open battle are checked as it's written. A
      // save within a second of the last one in that language (a double send), or
      // stamped before it (a slow request arriving late), writes nothing; the player
      // is still told it's in, as their newer code already is.
      const row = await sql<{ open: boolean }>`
        with open as (
          select 1 from game_match m
          join game_match_player p on p.match_id = m.id
          where m.id = ${matchId}::uuid and p.user_id = ${userId}
            and m.mode = 'battle' and m.finished_at is null
            and m.created_at > ${at}::timestamptz - ${BATTLE_OPEN}::interval),
        saved as (
          insert into battle_code (match_id, user_id, language, code, saved_at)
          select ${matchId}::uuid, ${userId}, ${language}, ${code}, ${at}
          where exists (select 1 from open)
          on conflict (match_id, user_id, language)
            do update set code = excluded.code, saved_at = excluded.saved_at
            where battle_code.saved_at <= excluded.saved_at - ${MIN_GAP}::interval
          returning 1)
        select exists (select 1 from open) as open`.execute(db);
      return row.rows[0]?.open === true;
    },

    load: async (matchId, userId) => {
      const rows = await db
        .selectFrom("battle_code")
        .select(["language", "code"])
        .where("match_id", "=", matchId)
        .where("user_id", "=", userId)
        .execute();
      return Object.fromEntries(rows.map((r) => [r.language, r.code]));
    },
  };
}
