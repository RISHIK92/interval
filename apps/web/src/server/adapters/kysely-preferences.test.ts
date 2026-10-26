import { randomUUID } from "node:crypto";
import type { DB } from "@interval/db";
import { sql, type Transaction } from "kysely";
import { afterAll, expect, test } from "vitest";
import { createDb } from "./kysely";
import type { Preferences } from "../ports";
import { kyselyPreferences } from "./kysely-preferences";

// PER-1, P1-W4-S01 against the real table; rolled back per case.
const connectionString = process.env["DATABASE_URL"];
if (connectionString === undefined) throw new Error("DATABASE_URL is not set");
const db = createDb(connectionString);

afterAll(async () => {
  await db.destroy();
});

class Rollback extends Error {}

async function withUser(
  body: (trx: Transaction<DB>, userId: string) => Promise<void>,
): Promise<void> {
  await expect(
    db.transaction().execute(async (trx) => {
      const userId = `prefs-${randomUUID()}`;
      const code = await trx
        .insertInto("invite_code")
        .values({
          code: `PREFS${randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`,
          beta_group: "student",
          max_uses: 1,
          expires_at: sql<Date>`now() + interval '1 day'`,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      await trx
        .insertInto("app_user")
        .values({
          id: userId,
          name: "n",
          email: `${userId}@example.test`,
          beta_group: "student",
          invite_code_id: code.id,
        })
        .execute();
      await body(trx, userId);
      throw new Rollback();
    }),
  ).rejects.toBeInstanceOf(Rollback);
}

test("onboarding's choices are kept once; a second create changes nothing", async () => {
  await withUser(async (trx, userId) => {
    const store = kyselyPreferences(trx);
    expect(await store.get(userId)).toBeNull();
    const first: Preferences = {
      topics: ["databases"],
      level: "beginner",
      breakLength: "1-3",
    };
    expect(await store.createIfAbsent(userId, first)).toBe(true);
    expect(
      await store.createIfAbsent(userId, {
        topics: ["backend"],
        level: "advanced",
        breakLength: "8-15",
      }),
    ).toBe(false);
    const stored = await store.get(userId);
    expect(stored).toMatchObject(first);
    // When onboarding saved them: the home page waits for a first feed only just after.
    expect(stored?.onboardedAt).toBeInstanceOf(Date);
  });
});

test("the guest purge takes the preferences with the user", async () => {
  await withUser(async (trx, userId) => {
    const store = kyselyPreferences(trx);
    await store.createIfAbsent(userId, {
      topics: ["backend"],
      level: "beginner",
      breakLength: "3-8",
    });
    await trx.deleteFrom("app_user").where("id", "=", userId).execute();
    expect(await store.get(userId)).toBeNull();
  });
});

test("the database refuses an empty topic list", async () => {
  await withUser(async (trx, userId) => {
    // The last statement of the case: a failed one aborts the transaction.
    await expect(
      kyselyPreferences(trx).createIfAbsent(userId, {
        topics: [],
        level: "beginner",
        breakLength: "1-3",
      }),
    ).rejects.toThrow(/check constraint/);
  });
});
