import { randomUUID } from "node:crypto";
import type { DB } from "@interval/db";
import { type Kysely, sql } from "kysely";
import { afterAll, expect, test } from "vitest";
import type { LldPractice } from "../ports";
import { createDb } from "./kysely";
import { kyselyLldPractice, memoryLldPractice } from "./kysely-lld-practice";

// ADR-0048 (Q-WD-28): LLD practice code autosaves over the version it was loaded at (a
// stale tab's save is refused), per problem and language; the worker's bests are read
// back per problem.
const connectionString = process.env["DATABASE_URL"];
if (connectionString === undefined) throw new Error("DATABASE_URL is not set");
const db = createDb(connectionString);

afterAll(async () => {
  await db.destroy();
});

class Rollback extends Error {}

async function inRollback(body: (trx: Kysely<DB>) => Promise<void>) {
  await expect(
    db.transaction().execute(async (trx) => {
      await body(trx);
      throw new Rollback();
    }),
  ).rejects.toThrow(Rollback);
}

async function player(trx: Kysely<DB>): Promise<string> {
  const code = await trx
    .insertInto("invite_code")
    .values({
      code: `LLD${randomUUID().slice(0, 8).toUpperCase()}`,
      beta_group: "developer",
      max_uses: 1,
      expires_at: sql<Date>`now() + interval '1 day'`,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  const id = `lld-${randomUUID()}`;
  await trx
    .insertInto("app_user")
    .values({
      id,
      name: "Ada",
      email: `${id}@lld.example.test`,
      beta_group: "developer",
      invite_code_id: code.id,
    })
    .execute();
  return id;
}

async function practiceProblem(trx: Kysely<DB>): Promise<string> {
  const slug = `p-${randomUUID().slice(0, 8)}`;
  const hash = "a".repeat(64);
  await trx
    .insertInto("lld_problem")
    .values({
      slug,
      title: "A problem",
      difficulty: "easy",
      statement: "# A",
      interface: "{}",
      limits: "{}",
      visible: "[]",
      private_key: `lld/problems/${slug}/${hash}.json`,
      content_hash: hash,
      pool: "practice",
      topic: "systems",
    })
    .execute();
  return slug;
}

async function codeContract(
  practice: LldPractice,
  user: string,
  slug: string,
): Promise<void> {
  expect(await practice.loadCode(user, slug)).toEqual(new Map());
  expect(await practice.saveCode(user, slug, "python", "a = 1", 0)).toBe(1);
  // Another tab that loaded nothing: stale.
  expect(await practice.saveCode(user, slug, "python", "b = 2", 0)).toBeNull();
  expect(await practice.saveCode(user, slug, "python", "a = 2", 1)).toBe(2);
  expect(await practice.saveCode(user, slug, "python", "a = 3", 1)).toBeNull();
  // Each language is its own copy.
  expect(await practice.saveCode(user, slug, "go", "package x", 0)).toBe(1);
  expect(await practice.loadCode(user, slug)).toEqual(
    new Map([
      ["python", { code: "a = 2", version: 2 }],
      ["go", { code: "package x", version: 1 }],
    ]),
  );
}

test("the fake keeps the code contract", async () => {
  await codeContract(memoryLldPractice(), "u1", "lru-cache");
});

test("code saves over its version in Postgres", async () => {
  await inRollback(async (trx) => {
    await codeContract(
      kyselyLldPractice(trx),
      await player(trx),
      await practiceProblem(trx),
    );
  });
});

test("bests are read back per problem", async () => {
  await inRollback(async (trx) => {
    const user = await player(trx);
    const slug = await practiceProblem(trx);
    const practice = kyselyLldPractice(trx);
    expect(await practice.bestFor(user, slug)).toBeNull();
    expect(await practice.best(user)).toEqual(new Map());
    const at = new Date("2026-11-23T12:05:00Z");
    await trx
      .insertInto("lld_practice_best")
      .values({
        user_id: user,
        problem_slug: slug,
        points: 820,
        visible_passed: 1,
        visible_total: 1,
        hidden_passed: 9,
        hidden_total: 10,
        concurrency_passed: 1,
        concurrency_total: 2,
        extension_passed: 0,
        extension_total: 0,
        language: "python",
        achieved_at: at,
        submits: 4,
      })
      .execute();
    const best = {
      slug,
      points: 820,
      layers: {
        visible: { passed: 1, total: 1 },
        hidden: { passed: 9, total: 10 },
        concurrency: { passed: 1, total: 2 },
        extension: { passed: 0, total: 0 },
      },
      language: "python",
      achievedAt: at,
      submits: 4,
    };
    expect(await practice.bestFor(user, slug)).toEqual(best);
    expect(await practice.best(user)).toEqual(new Map([[slug, best]]));
  });
});
