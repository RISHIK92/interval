import type { DB } from "@interval/db";
import { type Kysely, sql } from "kysely";
import type { DevicePushTokens } from "../ports";

// P4-W19-S04a (Q-P4-03): the worker pushes to these (S04b).
export function kyselyDevicePushTokens(db: Kysely<DB>): DevicePushTokens {
  return {
    save: async (userId, platform, token) => {
      await sql`insert into device_push_token (user_id, platform, token)
        values (${userId}, ${platform}, ${token})
        on conflict (token) do update
          set user_id = excluded.user_id, platform = excluded.platform`.execute(
        db,
      );
    },
    remove: async (userId, token) => {
      await db
        .deleteFrom("device_push_token")
        .where("user_id", "=", userId)
        .where("token", "=", token)
        .execute();
    },
  };
}
