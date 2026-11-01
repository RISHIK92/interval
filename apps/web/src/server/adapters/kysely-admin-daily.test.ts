import { randomUUID } from "node:crypto";
import type { DB } from "@interval/db";
import { sql, type Transaction } from "kysely";
import { afterAll, expect, test } from "vitest";
import { createDb } from "./kysely";
import { kyselyAdminDaily } from "./kysely-admin-daily";

// P3-W13-S05 (ADR-0031): the owner reviews tomorrow's daily challenge set, approving
// it or swapping a question by the same pick rule the worker uses.
const connectionString = process.env["DATABASE_URL"];
if (connectionString === undefined) {
  throw new Error("DATABASE_URL is not set; copy .env.example to .env");
}
const db = createDb(connectionString);

afterAll(async () => {
  await db.destroy();
});

class Rollback extends Error {}

const TODAY = sql<string>`(now() at time zone 'utc')::date`;
const TOMORROW = sql<string>`(now() at time zone 'utc')::date + 1`;

async function inRollback(
  body: (
    trx: Transaction<DB>,
    estimate: (stem: string) => Promise<string>,
  ) => Promise<void>,
): Promise<void> {
  await expect(
    db.transaction().execute(async (trx) => {
      // Only this test's questions and sets: what's there locally is set aside.
      await sql`update question set status = 'retired' where status = 'live'`.execute(
        trx,
      );
      await sql`delete from quiz_attempt where daily_day >= ${TODAY}`.execute(
        trx,
      );
      await sql`delete from daily_challenge where day >= ${TODAY}`.execute(trx);
      const estimate = async (stem: string) => {
        const concept = await trx
          .insertInto("concept")
          .values({
            slug: `daily-${randomUUID()}`,
            name: `Concept of ${stem}`,
            topic: "databases",
          })
          .returning("id")
          .executeTakeFirstOrThrow();
        const row = await trx
          .insertInto("question")
          .values({
            ordinal: 0,
            kind: "estimate",
            stem,
            answer: 10,
            unit: "ms",
            citation: "about 10 ms",
            source_url: `https://docs.example.test/${randomUUID()}`,
            source_title: `Page of ${stem}`,
            status: "live",
          })
          .returning("id")
          .executeTakeFirstOrThrow();
        await trx
          .insertInto("question_concept")
          .values({ question_id: row.id, concept_id: concept.id })
          .execute();
        return row.id;
      };
      await body(trx, estimate);
      throw new Rollback();
    }),
  ).rejects.toBeInstanceOf(Rollback);
}

test("tomorrow's set, before and after it's picked, with each question's concepts and source", async () => {
  await inRollback(async (trx, estimate) => {
    const daily = kyselyAdminDaily(trx);
    expect(await daily.sets()).toEqual({ today: null, tomorrow: null });
    const seek = await estimate("Disk seek?");
    await sql`select daily_challenge_pick(${TOMORROW})`.execute(trx);
    const { today, tomorrow } = await daily.sets();
    expect(today).toBeNull();
    expect(tomorrow).toMatchObject({
      approved: false,
      publishedUnreviewed: false,
      questions: [
        {
          position: 0,
          questionId: seek,
          kind: "estimate",
          stem: "Disk seek?",
          status: "live",
          concepts: ["Concept of Disk seek?"],
          source: "Page of Disk seek?",
        },
      ],
    });
    expect(tomorrow?.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

test("approving works for a day that hasn't started", async () => {
  await inRollback(async (trx, estimate) => {
    await estimate("Disk seek?");
    await sql`select daily_challenge_pick(${TODAY})`.execute(trx);
    await sql`select daily_challenge_pick(${TOMORROW})`.execute(trx);
    const daily = kyselyAdminDaily(trx);
    const sets = await daily.sets();
    if (sets.today === null || sets.tomorrow === null) throw new Error("sets");
    expect(await daily.approve(sets.today.day)).toBe(false);
    expect(await daily.approve(sets.tomorrow.day)).toBe(true);
    expect(await daily.approve(sets.tomorrow.day)).toBe(true);
    const after = await daily.sets();
    expect(after.tomorrow?.approved).toBe(true);
    expect(after.today?.approved).toBe(false);
  });
});

test("a swap takes another question of the kind; a started day or no fit swaps nothing", async () => {
  await inRollback(async (trx, estimate) => {
    const first = await estimate("Disk seek?");
    await sql`select daily_challenge_pick(${TOMORROW})`.execute(trx);
    const daily = kyselyAdminDaily(trx);
    const day = (await daily.sets()).tomorrow?.day ?? "";
    expect(await daily.swap(day, 0)).toBe(false);
    const other = await estimate("Round trip?");
    expect(await daily.swap(day, 0)).toBe(true);
    const after = (await daily.sets()).tomorrow?.questions ?? [];
    expect(after.map((q) => q.questionId)).toEqual([other]);
    expect(after.map((q) => q.questionId)).not.toContain(first);
    await sql`select daily_challenge_pick(${TODAY})`.execute(trx);
    const today = (await daily.sets()).today?.day ?? "";
    expect(await daily.swap(today, 0)).toBe(false);
  });
});

test("today's set says when it went out unreviewed", async () => {
  await inRollback(async (trx, estimate) => {
    await estimate("Disk seek?");
    await sql`select daily_challenge_pick(${TODAY})`.execute(trx);
    await sql`update daily_challenge set published_unreviewed_at = now()
      where day = ${TODAY}`.execute(trx);
    expect((await kyselyAdminDaily(trx).sets()).today).toMatchObject({
      approved: false,
      publishedUnreviewed: true,
    });
  });
});
