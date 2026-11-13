import { randomUUID } from "node:crypto";
import type { DB } from "@interval/db";
import { sql, type Transaction } from "kysely";
import { afterAll, expect, test } from "vitest";
import { createDb } from "./kysely";
import { kyselyPushSettings } from "./kysely-push-settings";

// P4-W24-S01 (Q-P4-13): which pushes, and the hour.
const connectionString = process.env["DATABASE_URL"];
if (connectionString === undefined) {
  throw new Error("DATABASE_URL is not set; copy .env.example to .env");
}
const db = createDb(connectionString);

afterAll(async () => {
  await db.destroy();
});

class Rollback extends Error {}

async function inRollback(
  body: (trx: Transaction<DB>, user: string) => Promise<void>,
): Promise<void> {
  await expect(
    db.transaction().execute(async (trx) => {
      const code = await trx
        .insertInto("invite_code")
        .values({
          code: `PUSH${randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`,
          beta_group: "student",
          max_uses: 1,
          expires_at: sql<Date>`now() + interval '1 day'`,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      const user = randomUUID();
      await trx
        .insertInto("app_user")
        .values({
          id: user,
          name: "n",
          email: `${user}@example.test`,
          beta_group: "student",
          invite_code_id: code.id,
        })
        .execute();
      await body(trx, user);
      throw new Rollback();
    }),
  ).rejects.toBeInstanceOf(Rollback);
}

const OFF = {
  digest: false,
  pathReminder: false,
  dailyChallenge: false,
  battleWindow: false,
  hour: 18,
};

test("all off at 18:00 until saved; a save reports only what it turned on or off", async () => {
  await inRollback(async (trx, user) => {
    const store = kyselyPushSettings(trx);
    expect(await store.get(user)).toEqual(OFF);
    expect(
      await store.save(user, { ...OFF, digest: true, hour: 9 }, "Asia/Kolkata"),
    ).toEqual([{ kind: "digest", on: true }]);
    expect(await store.get(user)).toEqual({ ...OFF, digest: true, hour: 9 });
    expect(
      await store.save(
        user,
        { ...OFF, dailyChallenge: true, hour: 9 },
        "Europe/Paris",
      ),
    ).toEqual([
      { kind: "digest", on: false },
      { kind: "daily_challenge", on: true },
    ]);
    // Only the hour or the zone: no kind changed.
    expect(
      await store.save(user, { ...OFF, dailyChallenge: true, hour: 10 }, "UTC"),
    ).toEqual([]);
    const row = await trx
      .selectFrom("push_preference")
      .select(["time_zone", "hour"])
      .where("user_id", "=", user)
      .executeTakeFirstOrThrow();
    expect(row).toEqual({ time_zone: "UTC", hour: 10 });
  });
});

// P5-W32: the app has no battles, so its saves leave the window reminder as it was.
test("a save without the battle window kind keeps it", async () => {
  await inRollback(async (trx, user) => {
    const store = kyselyPushSettings(trx);
    expect(
      await store.save(user, { ...OFF, battleWindow: true }, "UTC"),
    ).toEqual([{ kind: "battle_window", on: true }]);
    const fromApp = {
      digest: true,
      pathReminder: false,
      dailyChallenge: false,
      hour: 18,
    };
    expect(await store.save(user, fromApp, "UTC")).toEqual([
      { kind: "digest", on: true },
    ]);
    expect((await store.get(user)).battleWindow).toBe(true);
  });
});

test("the hour stays out of the quiet hours", async () => {
  await inRollback(async (trx, user) => {
    await expect(
      kyselyPushSettings(trx).save(user, { ...OFF, hour: 22 }, "UTC"),
    ).rejects.toThrow(/check/);
  });
});

// Two saves at once (two tabs, the web and the app): each change is counted once.
test("two saves at once report a change once between them", async () => {
  const code = await db
    .insertInto("invite_code")
    .values({
      code: `PUSHC${randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`,
      beta_group: "student",
      max_uses: 1,
      expires_at: sql<Date>`now() + interval '1 day'`,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  const user = randomUUID();
  await db
    .insertInto("app_user")
    .values({
      id: user,
      name: "n",
      email: `${user}@example.test`,
      beta_group: "student",
      invite_code_id: code.id,
    })
    .execute();
  try {
    const store = kyselyPushSettings(db);
    const both = await Promise.all([
      store.save(user, { ...OFF, digest: true }, "UTC"),
      store.save(user, { ...OFF, digest: true }, "UTC"),
    ]);
    expect(both.flat()).toEqual([{ kind: "digest", on: true }]);
  } finally {
    await db.deleteFrom("app_user").where("id", "=", user).execute();
    await db.deleteFrom("invite_code").where("id", "=", code.id).execute();
  }
});
