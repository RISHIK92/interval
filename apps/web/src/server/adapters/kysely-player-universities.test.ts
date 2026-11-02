import { randomUUID } from "node:crypto";
import type { DB } from "@interval/db";
import { type Kysely, sql, type Transaction } from "kysely";
import { afterAll, expect, test } from "vitest";
import type { PlayerUniversities, University } from "../ports";
import { createDb } from "./kysely";
import {
  kyselyPlayerUniversities,
  memoryPlayerUniversities,
} from "./kysely-player-universities";

// P3-W14-S03 (§6.7, ADR-0032): a university picked from the list or typed, changed at
// most once in 30 days; removing it is always allowed and keeps the clock.
const connectionString = process.env["DATABASE_URL"];
if (connectionString === undefined) throw new Error("DATABASE_URL is not set");
const db = createDb(connectionString);

afterAll(async () => {
  await db.destroy();
});

const DAY = 86_400_000;

// `token` makes the names unique to this run; `listed` are, in order: "<token> Institute
// of Technology" (IN), "Old <token> College" (GB), "<token> University" (US), and
// "Twin <token>" in FR and in DE.
async function contract(
  unis: PlayerUniversities,
  userId: string,
  token: string,
  listed: University[],
  age: (days: number) => Promise<void>,
): Promise<void> {
  const [institute, college, university, twinFR, twinDE] = listed as [
    University,
    University,
    University,
    University,
    University,
  ];
  // Starting with the query first, then shorter names; any case; the limit holds.
  expect(await unis.search(token.toUpperCase(), 10)).toEqual([
    university,
    institute,
    twinFR,
    twinDE,
    college,
  ]);
  expect(await unis.search(token, 1)).toEqual([university]);
  // LIKE's wildcards are only characters.
  expect(await unis.search(`${token}%`, 10)).toEqual([]);

  expect(await unis.get(userId)).toEqual({
    university: null,
    changeableFrom: null,
  });
  expect(await unis.set(userId, "999999999999")).toEqual({
    ok: false,
    reason: "unknown",
  });
  expect(await unis.set(userId, institute.id)).toEqual({
    ok: true,
    university: institute,
    previous: null,
  });
  const { university: now, changeableFrom } = await unis.get(userId);
  expect(now).toEqual(institute);
  expect(
    Math.abs((changeableFrom?.getTime() ?? 0) - Date.now() - 30 * DAY),
  ).toBeLessThan(60_000);

  // The same one again: nothing changes, the clock isn't restarted.
  expect(await unis.set(userId, institute.id)).toEqual({
    ok: true,
    university: institute,
    previous: institute,
  });
  expect((await unis.get(userId)).changeableFrom).toEqual(changeableFrom);
  // Typed with another case, it's the same listed one: still nothing changes.
  expect(
    await unis.setTyped(userId, institute.name.toLowerCase()),
  ).toMatchObject({ ok: true, university: institute });

  // Inside the month: refused with the day it opens, and no typed row is made.
  expect(await unis.set(userId, college.id)).toEqual({
    ok: false,
    reason: "soon",
    changeableFrom,
  });
  expect(await unis.setTyped(userId, `${token} Polytechnic`)).toEqual({
    ok: false,
    reason: "soon",
    changeableFrom,
  });
  expect(await unis.search(`${token} Poly`, 10)).toEqual([]);

  // Removing is always allowed and keeps the clock.
  expect(await unis.remove(userId)).toEqual(institute);
  expect(await unis.get(userId)).toEqual({
    university: null,
    changeableFrom,
  });
  expect(await unis.set(userId, college.id)).toMatchObject({
    ok: false,
    reason: "soon",
  });
  expect(await unis.remove(userId)).toBeNull();

  // A month on: a typed name makes a typed university, found by search after.
  await age(31);
  const typed = await unis.setTyped(userId, `${token} Polytechnic`);
  expect(typed).toMatchObject({
    ok: true,
    university: { name: `${token} Polytechnic`, country: null, listed: false },
    previous: null,
  });
  const polytechnic = typed.ok ? typed.university : null;
  expect(await unis.search(`${token} poly`, 10)).toEqual([polytechnic]);

  // Typed again in another case, it's the same row: nothing changes.
  await age(31);
  expect(await unis.setTyped(userId, `${token} POLYTECHNIC`)).toEqual({
    ok: true,
    university: polytechnic,
    previous: polytechnic,
  });
  expect(await unis.set(userId, college.id)).toEqual({
    ok: true,
    university: college,
    previous: polytechnic,
  });

  // A name two listed universities share isn't guessed: it's typed, like a missing one.
  await age(31);
  const twin = await unis.setTyped(userId, `twin ${token}`);
  expect(twin).toMatchObject({
    ok: true,
    university: { name: `twin ${token}`, country: null, listed: false },
  });
}

test("the in-memory fake keeps the contract", async () => {
  let now = Date.now();
  const token = "Zed";
  const listed: University[] = [
    { id: "1", name: `${token} Institute of Technology`, country: "IN" },
    { id: "2", name: `Old ${token} College`, country: "GB" },
    { id: "3", name: `${token} University`, country: "US" },
    { id: "4", name: `Twin ${token}`, country: "FR" },
    { id: "5", name: `Twin ${token}`, country: "DE" },
  ].map((u) => ({ ...u, listed: true }));
  await contract(
    memoryPlayerUniversities(listed, () => now),
    "u1",
    token,
    listed,
    (days) => {
      now += days * DAY;
      return Promise.resolve();
    },
  );
});

class Rollback extends Error {}

async function account(trx: Kysely<DB>): Promise<string> {
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
  const userId = `university-${randomUUID()}`;
  await trx
    .insertInto("app_user")
    .values({
      id: userId,
      name: "Ada",
      email: `${userId}@university.example.test`,
      beta_group: "developer",
      invite_code_id: code.id,
    })
    .execute();
  return userId;
}

test("the Postgres adapter keeps the contract", async () => {
  await expect(
    db.transaction().execute(async (trx: Transaction<DB>) => {
      const token = `Q${randomUUID().slice(0, 8)}`;
      const listed: University[] = [];
      for (const [name, country] of [
        [`${token} Institute of Technology`, "IN"],
        [`Old ${token} College`, "GB"],
        [`${token} University`, "US"],
        [`Twin ${token}`, "FR"],
        [`Twin ${token}`, "DE"],
      ] as const) {
        const row = await trx
          .insertInto("university")
          .values({ name, country, listed: true })
          .returning("id")
          .executeTakeFirstOrThrow();
        listed.push({ id: row.id, name, country, listed: true });
      }
      const userId = await account(trx);
      await contract(
        kyselyPlayerUniversities(trx),
        userId,
        token,
        listed,
        async (days) => {
          await sql`update player_university
            set changed_at = changed_at - make_interval(days => ${days})
            where user_id = ${userId}`.execute(trx);
        },
      );
      throw new Rollback();
    }),
  ).rejects.toBeInstanceOf(Rollback);
});

// Committed for real: two first picks at once must queue, so only one is a change.
test("first picks at once: one is set, the others refused", async () => {
  const token = `Q${randomUUID().slice(0, 8)}`;
  const userId = await account(db);
  const ids: string[] = [];
  try {
    for (const country of ["IN", "GB", "US", "FR", "DE", "BR", "JP", "KE"]) {
      const row = await db
        .insertInto("university")
        .values({ name: `${token} Race`, country, listed: true })
        .returning("id")
        .executeTakeFirstOrThrow();
      ids.push(row.id);
    }
    // Every connection open first, so the picks really overlap.
    await Promise.all(ids.map(() => sql`select pg_sleep(0.05)`.execute(db)));
    const unis = kyselyPlayerUniversities(db);
    const outcomes = await Promise.all(ids.map((id) => unis.set(userId, id)));
    expect(outcomes.filter((o) => o.ok)).toHaveLength(1);
    expect(outcomes.filter((o) => !o.ok && o.reason === "soon")).toHaveLength(
      ids.length - 1,
    );
  } finally {
    await db.deleteFrom("app_user").where("id", "=", userId).execute();
    await db.deleteFrom("university").where("id", "in", ids).execute();
  }
});
