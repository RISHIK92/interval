import { randomUUID } from "node:crypto";
import type { DB } from "@interval/db";
import { sql, type Transaction } from "kysely";
import { afterAll, expect, test } from "vitest";
import { createDb } from "./kysely";
import { kyselyPushSubscriptions } from "./kysely-push-subscriptions";

// P3-W17-S05b: a browser's subscription is the player's; a re-subscribe moves it; only
// its owner removes it.
const connectionString = process.env["DATABASE_URL"];
if (connectionString === undefined) throw new Error("DATABASE_URL is not set");
const db = createDb(connectionString);

afterAll(async () => {
  await db.destroy();
});

class Rollback extends Error {}
const P256DH = `B${"a".repeat(86)}`;
const AUTH = "b".repeat(22);

test("saved, moved by a re-subscribe, removed by its owner only", async () => {
  await expect(
    db.transaction().execute(async (trx: Transaction<DB>) => {
      const code = await trx
        .insertInto("invite_code")
        .values({
          code: `PUSH${randomUUID().slice(0, 8).toUpperCase()}`,
          beta_group: "developer",
          max_uses: 10,
          expires_at: sql<Date>`now() + interval '1 day'`,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      const [a = "", b = ""] = [0, 1].map(() => `push-${randomUUID()}`);
      await trx
        .insertInto("app_user")
        .values(
          [a, b].map((id) => ({
            id,
            name: "Ada",
            email: `${id}@push.example.test`,
            beta_group: "developer" as const,
            invite_code_id: code.id,
          })),
        )
        .execute();
      const subs = kyselyPushSubscriptions(trx);
      const endpoint = `https://push.example/${randomUUID()}`;
      const owners = () =>
        trx
          .selectFrom("push_subscription")
          .select("user_id")
          .where("endpoint", "=", endpoint)
          .execute();
      await subs.save(a, { endpoint, p256dh: P256DH, auth: AUTH });
      await subs.save(a, { endpoint, p256dh: P256DH, auth: AUTH });
      expect(await owners()).toEqual([{ user_id: a }]);
      await subs.save(b, { endpoint, p256dh: P256DH, auth: AUTH });
      expect(await owners()).toEqual([{ user_id: b }]);
      await subs.remove(a, endpoint);
      expect(await owners()).toEqual([{ user_id: b }]);
      await subs.remove(b, endpoint);
      expect(await owners()).toEqual([]);
      throw new Rollback();
    }),
  ).rejects.toBeInstanceOf(Rollback);
});
