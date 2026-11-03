import type { DB } from "@interval/db";
import { type Kysely, sql } from "kysely";
import type { PushSubscriptions } from "../ports";

// P3-W17-S05b (§7, Q-P3-18): the worker pushes to these (interval_jobs/agent_push.py).
export function kyselyPushSubscriptions(db: Kysely<DB>): PushSubscriptions {
  return {
    save: async (userId, { endpoint, p256dh, auth }) => {
      await sql`insert into push_subscription (user_id, endpoint, p256dh, auth)
        values (${userId}, ${endpoint}, ${p256dh}, ${auth})
        on conflict (endpoint) do update
          set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`.execute(
        db,
      );
    },
    remove: async (userId, endpoint) => {
      await db
        .deleteFrom("push_subscription")
        .where("user_id", "=", userId)
        .where("endpoint", "=", endpoint)
        .execute();
    },
  };
}
