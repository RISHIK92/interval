import { randomUUID } from "node:crypto";
import type { DB } from "@interval/db";
import { sql, type Transaction } from "kysely";
import { afterAll, expect, test } from "vitest";
import { createDb, kyselyEntitlements } from "./kysely";

// OPS-3, Q-P1-22 against the real view; every case runs in a rolled-back transaction.
const connectionString = process.env["DATABASE_URL"];
if (connectionString === undefined) throw new Error("DATABASE_URL is not set");
const db = createDb(connectionString);

afterAll(async () => {
  await db.destroy();
});

class Rollback extends Error {}

async function rolledBack(
  body: (trx: Transaction<DB>, userId: string) => Promise<void>,
): Promise<void> {
  await expect(
    db.transaction().execute(async (trx) => {
      // Unique per case, so parallel runs on the shared dev DB never wait on each other.
      const userId = `entitle-${randomUUID()}`;
      const code = await trx
        .insertInto("invite_code")
        .values({
          code: `ENTITLE${randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`,
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

test("the beta plan grants feed.read", async () => {
  await rolledBack(async (trx, userId) => {
    expect(await kyselyEntitlements(trx).can(userId, "feed.read")).toBe(true);
  });
});

test("admin.review is granted per user, on top of the plan (Q-P1-29)", async () => {
  await rolledBack(async (trx, userId) => {
    const entitlements = kyselyEntitlements(trx);
    expect(await entitlements.can(userId, "admin.review")).toBe(false);
    await trx
      .insertInto("user_capability")
      .values({ user_id: userId, capability: "admin.review" })
      .execute();
    expect(await entitlements.can(userId, "admin.review")).toBe(true);
  });
});

test("limits come from the plan: a number, null for no limit, 0 when not granted", async () => {
  await rolledBack(async (trx, userId) => {
    const entitlements = kyselyEntitlements(trx);
    expect(await entitlements.limit(userId, "ai.notes.daily")).toBe(20);
    expect(await entitlements.limit(userId, "feed.read")).toBeNull();
    expect(await entitlements.limit(userId, "admin.review")).toBe(0);
  });
});

test("an unknown user can do nothing", async () => {
  const entitlements = kyselyEntitlements(db);
  expect(await entitlements.can("nobody", "feed.read")).toBe(false);
  expect(await entitlements.limit("nobody", "ai.notes.daily")).toBe(0);
});

test("an unknown capability does not compile", () => {
  const entitlements = kyselyEntitlements(db);
  // Checked by `tsc`: the capability list is the generated enum (OPS-3).
  // @ts-expect-error "feed.write" is not a capability
  const check = () => entitlements.can("u", "feed.write");
  expect(typeof check).toBe("function");
});
