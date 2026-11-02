import { randomUUID } from "node:crypto";
import type { DB } from "@interval/db";
import { sql, type Transaction } from "kysely";
import { afterAll, expect, test } from "vitest";
import type { PlayerCountries } from "../ports";
import { createDb } from "./kysely";
import {
  kyselyPlayerCountries,
  memoryPlayerCountries,
} from "./kysely-player-countries";

// P3-W14-S02 (Q-P3-08; owner, 2026-11-02): a country set or changed at most once in
// 30 days; removing it is always allowed and keeps the clock.
const connectionString = process.env["DATABASE_URL"];
if (connectionString === undefined) throw new Error("DATABASE_URL is not set");
const db = createDb(connectionString);

afterAll(async () => {
  await db.destroy();
});

const DAY = 86_400_000;

// `age(days)` makes the player's last change that many days old.
async function contract(
  countries: PlayerCountries,
  userId: string,
  age: (days: number) => Promise<void>,
): Promise<void> {
  expect(await countries.get(userId)).toEqual({
    country: null,
    changeableFrom: null,
  });
  expect(await countries.set(userId, "IN")).toEqual({
    ok: true,
    previous: null,
  });
  const { country, changeableFrom } = await countries.get(userId);
  expect(country).toBe("IN");
  // About 30 days from now.
  expect(
    Math.abs((changeableFrom?.getTime() ?? 0) - Date.now() - 30 * DAY),
  ).toBeLessThan(60_000);

  // The country it already has: nothing changes, and the clock isn't restarted.
  expect(await countries.set(userId, "IN")).toEqual({
    ok: true,
    previous: "IN",
  });
  expect((await countries.get(userId)).changeableFrom).toEqual(changeableFrom);

  // Inside the month: refused, with the day it opens; nothing changes.
  const refused = await countries.set(userId, "DE");
  expect(refused).toMatchObject({ ok: false });
  expect(refused.ok ? null : refused.changeableFrom).toEqual(changeableFrom);
  expect((await countries.get(userId)).country).toBe("IN");

  // Removing is always allowed and keeps the clock: set again is still refused.
  expect(await countries.remove(userId)).toBe("IN");
  expect(await countries.get(userId)).toEqual({
    country: null,
    changeableFrom,
  });
  expect(await countries.set(userId, "DE")).toMatchObject({ ok: false });
  expect(await countries.remove(userId)).toBeNull();

  // A month on, a change is allowed again.
  await age(31);
  expect(await countries.get(userId)).toEqual({
    country: null,
    changeableFrom: null,
  });
  expect(await countries.set(userId, "DE")).toEqual({
    ok: true,
    previous: null,
  });
  await age(30);
  expect(await countries.set(userId, "FR")).toEqual({
    ok: true,
    previous: "DE",
  });
}

test("the in-memory fake keeps the contract", async () => {
  let now = Date.now();
  await contract(
    memoryPlayerCountries(() => now),
    "u1",
    (days) => {
      now += days * DAY;
      return Promise.resolve();
    },
  );
});

class Rollback extends Error {}

test("the Postgres adapter keeps the contract", async () => {
  await expect(
    db.transaction().execute(async (trx: Transaction<DB>) => {
      const code = await trx
        .insertInto("invite_code")
        .values({
          code: `LAND${randomUUID().slice(0, 8).toUpperCase()}`,
          beta_group: "developer",
          max_uses: 1,
          expires_at: sql<Date>`now() + interval '1 day'`,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      const userId = `country-${randomUUID()}`;
      await trx
        .insertInto("app_user")
        .values({
          id: userId,
          name: "Ada",
          email: `${userId}@country.example.test`,
          beta_group: "developer",
          invite_code_id: code.id,
        })
        .execute();
      await contract(kyselyPlayerCountries(trx), userId, async (days) => {
        await sql`update player_country
          set changed_at = changed_at - make_interval(days => ${days})
          where user_id = ${userId}`.execute(trx);
      });
      throw new Rollback();
    }),
  ).rejects.toBeInstanceOf(Rollback);
});
