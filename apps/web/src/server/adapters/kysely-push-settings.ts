import type { PushPreferences } from "@interval/api-client";
import type { DB } from "@interval/db";
import { type Kysely, sql } from "kysely";
import type { PushKind, PushSettings } from "../ports";

// P4-W24-S01 (Q-P4-13): every kind off until turned on, 18:00 until changed.
const DEFAULTS: PushPreferences = {
  digest: false,
  pathReminder: false,
  dailyChallenge: false,
  battleWindow: false,
  hour: 18,
};

export function kyselyPushSettings(db: Kysely<DB>): PushSettings {
  return {
    get: async (userId) => {
      const row = await db
        .selectFrom("push_preference")
        .select([
          "digest",
          "path_reminder",
          "daily_challenge",
          "battle_window",
          "hour",
        ])
        .where("user_id", "=", userId)
        .executeTakeFirst();
      return row === undefined
        ? DEFAULTS
        : {
            digest: row.digest,
            pathReminder: row.path_reminder,
            dailyChallenge: row.daily_challenge,
            battleWindow: row.battle_window,
            hour: row.hour,
          };
    },
    // The row first (all off), then a locked read of what it was and the update in one
    // statement: two saves at once wait on the lock, and each compares against what the
    // other left, so a change is counted once.
    save: async (userId, next, timeZone) => {
      await db
        .insertInto("push_preference")
        .values({ user_id: userId, time_zone: timeZone })
        .onConflict((oc) => oc.column("user_id").doNothing())
        .execute();
      const result = await sql<{
        digest: boolean;
        path_reminder: boolean;
        daily_challenge: boolean;
        battle_window: boolean;
      }>`
        with before as (
          select digest, path_reminder, daily_challenge, battle_window
          from push_preference
          where user_id = ${userId}
          for update
        )
        update push_preference p set
          digest = ${next.digest},
          path_reminder = ${next.pathReminder},
          daily_challenge = ${next.dailyChallenge},
          battle_window = coalesce(${next.battleWindow ?? null}::boolean, p.battle_window),
          hour = ${next.hour},
          time_zone = ${timeZone},
          updated_at = now()
        from before
        where p.user_id = ${userId}
        returning before.digest, before.path_reminder, before.daily_challenge,
          before.battle_window
      `.execute(db);
      const was = result.rows[0];
      if (was === undefined) throw new Error("push settings: row not saved");
      const old = was;
      const now: Record<PushKind, boolean> = {
        digest: next.digest,
        path_reminder: next.pathReminder,
        daily_challenge: next.dailyChallenge,
        battle_window: next.battleWindow ?? old.battle_window,
      };
      return (Object.keys(now) as PushKind[])
        .filter((kind) => now[kind] !== old[kind])
        .map((kind) => ({ kind, on: now[kind] }));
    },
  };
}
