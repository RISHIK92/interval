import { randomUUID } from "node:crypto";
import type { DB } from "@interval/db";
import { type Kysely, sql, type Transaction } from "kysely";
import { afterAll, expect, test } from "vitest";
import type { Follows, Usernames } from "../ports";
import { createDb } from "./kysely";
import { kyselyFollows, kyselyUsernames, memoryPeople } from "./kysely-people";

// P3-W14-S05 (§6.7, Q-P3-11; owner, 2026-11-02): usernames, chosen once; one-way follows.
const connectionString = process.env["DATABASE_URL"];
if (connectionString === undefined) throw new Error("DATABASE_URL is not set");
const db = createDb(connectionString);

afterAll(async () => {
  await db.destroy();
});

// `t` makes usernames unique to this run (lower case, 4 characters).
async function contract(
  usernames: Usernames,
  follows: Follows,
  [a, b, c, d]: [string, string, string, string],
  t: string,
): Promise<void> {
  expect(await usernames.get(a)).toBeNull();
  expect(await usernames.claim(a, `${t}_ada`)).toBe("claimed");
  expect(await usernames.get(a)).toEqual({
    username: `${t}_ada`,
    searchable: true,
  });
  // Never changed, and never shared.
  expect(await usernames.claim(a, `${t}_other`)).toBe("has-one");
  expect(await usernames.claim(a, `${t}_ada`)).toBe("has-one");
  expect(await usernames.claim(b, `${t}_ada`)).toBe("taken");
  expect(await usernames.claim(b, `${t}_bob`)).toBe("claimed");
  expect(await usernames.claim(c, `${t}xcat`)).toBe("claimed");

  // Starts with the prefix, in order; `_` is only a character.
  expect(await usernames.search(t, 10)).toEqual([
    { userId: a, username: `${t}_ada` },
    { userId: b, username: `${t}_bob` },
    { userId: c, username: `${t}xcat` },
  ]);
  expect(await usernames.search(`${t}_`, 10)).toEqual([
    { userId: a, username: `${t}_ada` },
    { userId: b, username: `${t}_bob` },
  ]);
  expect(await usernames.search(t, 1)).toHaveLength(1);
  expect(await usernames.search(`${t}%`, 10)).toEqual([]);
  // Hidden from search, still found by the exact name.
  await usernames.setSearchable(b, false);
  expect(await usernames.get(b)).toEqual({
    username: `${t}_bob`,
    searchable: false,
  });
  expect(await usernames.search(`${t}_`, 10)).toEqual([
    { userId: a, username: `${t}_ada` },
  ]);
  expect(await usernames.byName(`${t}_bob`)).toBe(b);
  expect(await usernames.byName(`${t}_nobody`)).toBeNull();

  // Following: once, never oneself; both sides listed in username order.
  expect(await follows.follow(a, c)).toBe(true);
  expect(await follows.follow(a, b)).toBe(true);
  expect(await follows.follow(a, b)).toBe(false);
  expect(await follows.follow(a, a)).toBe(false);
  expect(await follows.follow(c, b)).toBe(true);
  expect(await follows.following(a)).toEqual([
    { userId: b, username: `${t}_bob` },
    { userId: c, username: `${t}xcat` },
  ]);
  expect(await follows.followers(b)).toEqual([
    { userId: a, username: `${t}_ada` },
    { userId: c, username: `${t}xcat` },
  ]);
  // A player without a username isn't listed; following needs one (the action checks).
  expect(await follows.follow(d, b)).toBe(true);
  expect(await follows.followers(b)).toHaveLength(2);

  expect(await follows.unfollow(a, b)).toBe(true);
  expect(await follows.unfollow(a, b)).toBe(false);
  expect(await follows.following(a)).toEqual([
    { userId: c, username: `${t}xcat` },
  ]);
  expect(await follows.followers(a)).toEqual([]);
}

test("the in-memory fake keeps the contract", async () => {
  const { usernames, follows } = memoryPeople();
  await contract(usernames, follows, ["a", "b", "c", "d"], "zq");
});

class Rollback extends Error {}

async function accounts(trx: Kysely<DB>, count: number): Promise<string[]> {
  const code = await trx
    .insertInto("invite_code")
    .values({
      code: `PEOP${randomUUID().slice(0, 8).toUpperCase()}`,
      beta_group: "developer",
      max_uses: 10,
      expires_at: sql<Date>`now() + interval '1 day'`,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  const ids = Array.from({ length: count }, () => `people-${randomUUID()}`);
  await trx
    .insertInto("app_user")
    .values(
      ids.map((id) => ({
        id,
        name: "Ada",
        email: `${id}@people.example.test`,
        beta_group: "developer" as const,
        invite_code_id: code.id,
      })),
    )
    .execute();
  return ids;
}

test("the Postgres adapters keep the contract", async () => {
  await expect(
    db.transaction().execute(async (trx: Transaction<DB>) => {
      const [a, b, c, d] = await accounts(trx, 4);
      if (!a || !b || !c || !d) throw new Error("accounts");
      const t = `q${randomUUID().replace(/-/g, "").slice(0, 3)}`;
      await contract(kyselyUsernames(trx), kyselyFollows(trx), [a, b, c, d], t);
      throw new Rollback();
    }),
  ).rejects.toBeInstanceOf(Rollback);
});
