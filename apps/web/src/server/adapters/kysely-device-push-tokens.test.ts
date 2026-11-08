import { randomUUID } from "node:crypto";
import type { DB } from "@interval/db";
import { sql, type Transaction } from "kysely";
import { afterAll, expect, test } from "vitest";
import { createDb } from "./kysely";
import { kyselyDevicePushTokens } from "./kysely-device-push-tokens";

// P4-W19-S04a: a phone's token is one user's; signing in as another moves it; only its
// owner removes it.
const connectionString = process.env["DATABASE_URL"];
if (connectionString === undefined) throw new Error("DATABASE_URL is not set");
const db = createDb(connectionString);

afterAll(async () => {
  await db.destroy();
});

class Rollback extends Error {}

test("saved, moved by another sign-in, removed by its owner only", async () => {
  await expect(
    db.transaction().execute(async (trx: Transaction<DB>) => {
      const code = await trx
        .insertInto("invite_code")
        .values({
          code: `DPT${randomUUID().slice(0, 8).toUpperCase()}`,
          beta_group: "developer",
          max_uses: 10,
          expires_at: sql<Date>`now() + interval '1 day'`,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      const [a = "", b = ""] = [0, 1].map(() => `dpt-${randomUUID()}`);
      await trx
        .insertInto("app_user")
        .values(
          [a, b].map((id) => ({
            id,
            name: "Ada",
            email: `${id}@dpt.example.test`,
            beta_group: "developer" as const,
            invite_code_id: code.id,
          })),
        )
        .execute();
      const tokens = kyselyDevicePushTokens(trx);
      const token = randomUUID().replaceAll("-", "");
      const rows = () =>
        trx
          .selectFrom("device_push_token")
          .select(["user_id", "platform"])
          .where("token", "=", token)
          .execute();
      await tokens.save(a, "ios", token);
      await tokens.save(a, "ios", token);
      expect(await rows()).toEqual([{ user_id: a, platform: "ios" }]);
      await tokens.save(b, "ios", token);
      expect(await rows()).toEqual([{ user_id: b, platform: "ios" }]);
      await tokens.remove(a, token); // not a's any more
      expect(await rows()).toHaveLength(1);
      await tokens.remove(b, token);
      expect(await rows()).toEqual([]);
      throw new Rollback();
    }),
  ).rejects.toBeInstanceOf(Rollback);
});
