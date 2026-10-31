import { randomUUID } from "node:crypto";
import type { DB } from "@interval/db";
import { sql, type Transaction } from "kysely";
import { afterAll, expect, test } from "vitest";
import { createDb } from "./kysely";
import { kyselyAdminQuestions } from "./kysely-admin-questions";

// Q-2, P2-W8-S03: the spot-check queue; Keep or Retire decides a review once.
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
  body: (
    trx: Transaction<DB>,
    ids: { sampled: string; flagged: string; unqueued: string },
  ) => Promise<void>,
): Promise<void> {
  await expect(
    db.transaction().execute(async (trx) => {
      const source = await trx
        .insertInto("source")
        .values({
          name: `aq-${randomUUID()}`,
          feed_url: "https://aq.example.test/feed.xml",
          rights_profile: "full_text_internal",
          moments_seeded: true,
          moments_enabled: true,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      const item = await trx
        .insertInto("content_item")
        .values({
          source_id: source.id,
          guid: "aq-1",
          canonical_url: "https://aq.example.test/post",
          title: "Consensus in practice",
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      const moment = await trx
        .insertInto("moment")
        .values({
          content_item_id: item.id,
          ordinal: 0,
          title: "Raft",
          estimated_minutes: 3,
          link: "https://aq.example.test/post#raft",
          link_type: "anchor",
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      const question = (ordinal: number, status: "live" | "flagged") =>
        trx
          .insertInto("question")
          .values({
            moment_id: moment.id,
            ordinal,
            stem: `Question ${String(ordinal)}?`,
            options: ["right", "w1", "w2", "w3"],
            correct: 0,
            citation: "Raft elects a leader.",
            status,
            generator_model: "m",
            prompt_version: 1,
            content_hash: "h",
            validator_model: "m",
            validator_answer: 0,
            validated_at: new Date(),
          })
          .returning("id")
          .executeTakeFirstOrThrow();
      const sampled = await question(0, "live");
      const flagged = await question(1, "flagged");
      const unqueued = await question(2, "live");
      await trx
        .insertInto("question_review")
        .values([
          { question_id: sampled.id, reason: "sample" },
          { question_id: flagged.id, reason: "flagged" },
        ])
        .execute();
      await body(trx, {
        sampled: sampled.id,
        flagged: flagged.id,
        unqueued: unqueued.id,
      });
      throw new Rollback();
    }),
  ).rejects.toBeInstanceOf(Rollback);
}

test("the queue lists undecided reviews with the question, its key and its section", async () => {
  await inRollback(async (trx, { sampled, flagged }) => {
    const queue = await kyselyAdminQuestions(trx).open();
    const ours = queue.filter((q) => [sampled, flagged].includes(q.questionId));
    expect(ours.map((q) => q.reason).sort()).toEqual(["flagged", "sample"]);
    expect(ours[0]).toMatchObject({
      options: ["right", "w1", "w2", "w3"],
      correct: 0,
      validatorAnswer: 0,
      citation: "Raft elects a leader.",
      articleTitle: "Consensus in practice",
      sectionTitle: "Raft",
      link: "https://aq.example.test/post#raft",
    });
  });
});

test("Keep returns a flagged question to live; Retire retires it; each review is decided once", async () => {
  await inRollback(async (trx, { sampled, flagged, unqueued }) => {
    const admin = kyselyAdminQuestions(trx);
    expect(await admin.decide(flagged, "keep", "admin-1")).toBe(true);
    expect(await admin.decide(sampled, "retire", "admin-1")).toBe(true);
    expect(await admin.decide(sampled, "keep", "admin-1")).toBe(false);
    expect(await admin.decide(unqueued, "retire", "admin-1")).toBe(false);
    const statuses = await trx
      .selectFrom("question")
      .select(["id", "status"])
      .where("id", "in", [sampled, flagged, unqueued])
      .execute();
    expect(Object.fromEntries(statuses.map((r) => [r.id, r.status]))).toEqual({
      [sampled]: "retired",
      [flagged]: "live",
      [unqueued]: "live",
    });
    const open = await admin.open();
    expect(open.some((q) => [sampled, flagged].includes(q.questionId))).toBe(
      false,
    );
  });
});

test("Keep leaves a sampled live question live; a retired question leaves the queue", async () => {
  await inRollback(async (trx, { sampled, flagged }) => {
    const admin = kyselyAdminQuestions(trx);
    await trx
      .updateTable("question")
      .set({ status: "retired" })
      .where("id", "=", flagged)
      .execute();
    expect((await admin.open()).some((q) => q.questionId === flagged)).toBe(
      false,
    );
    expect(await admin.decide(sampled, "keep", "admin-1")).toBe(true);
    const row = await trx
      .selectFrom("question")
      .select("status")
      .where("id", "=", sampled)
      .executeTakeFirstOrThrow();
    expect(row.status).toBe("live");
  });
});

// P3-W13-S03 (Q-P3-05 (b)): the owner writes estimation questions, citing the source
// page; they go live at once and are spot-checked like any other.
const estimate = (concepts: string[]) => ({
  stem: "How many writes per second can one Postgres box take?",
  answer: 10_000,
  unit: "writes per second",
  concepts,
  difficulty: "intermediate" as const,
  sourceUrl: "https://docs.example.test/limits",
  sourceTitle: "Postgres limits",
  citation: "A single box takes about ten thousand writes per second.",
});

async function concept(trx: Transaction<DB>, retired = false) {
  const row = await trx
    .insertInto("concept")
    .values({
      slug: `aq-${randomUUID()}`,
      name: "write throughput",
      topic: "databases",
      ...(retired ? { retired_at: new Date() } : {}),
    })
    .returning(["id", "slug"])
    .executeTakeFirstOrThrow();
  return row;
}

test("a hand-written estimate is stored live with its concepts and source", async () => {
  await inRollback(async (trx) => {
    const c = await concept(trx);
    const id = await kyselyAdminQuestions(trx).writeEstimate(
      estimate([c.slug, c.slug]),
    );
    if (id === null) throw new Error("not saved");
    const row = await trx
      .selectFrom("question")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirstOrThrow();
    expect(row).toMatchObject({
      kind: "estimate",
      status: "live",
      answer: 10_000,
      unit: "writes per second",
      source_url: "https://docs.example.test/limits",
      source_title: "Postgres limits",
      difficulty: "intermediate",
      options: null,
      correct: null,
      moment_id: null,
      generator_model: null,
    });
    const concepts = await trx
      .selectFrom("question_concept")
      .select("concept_id")
      .where("question_id", "=", id)
      .execute();
    expect(concepts).toEqual([{ concept_id: c.id }]);
  });
});

test("an unknown or retired concept saves nothing", async () => {
  await inRollback(async (trx) => {
    const live = await concept(trx);
    const retired = await concept(trx, true);
    const admin = kyselyAdminQuestions(trx);
    const before = await trx
      .selectFrom("question")
      .select(sql<string>`count(*)`.as("n"))
      .executeTakeFirstOrThrow();
    expect(
      await admin.writeEstimate(estimate([live.slug, "no-such-concept"])),
    ).toBeNull();
    expect(
      await admin.writeEstimate(estimate([live.slug, retired.slug])),
    ).toBeNull();
    const after = await trx
      .selectFrom("question")
      .select(sql<string>`count(*)`.as("n"))
      .executeTakeFirstOrThrow();
    expect(after.n).toBe(before.n);
  });
});

test("an estimate in the queue shows its answer, unit and source; Keep and Retire work", async () => {
  await inRollback(async (trx, { sampled }) => {
    const c = await concept(trx);
    const admin = kyselyAdminQuestions(trx);
    const id = await admin.writeEstimate(estimate([c.slug]));
    if (id === null) throw new Error("not saved");
    await trx
      .insertInto("question_review")
      .values({ question_id: id, reason: "sample" })
      .execute();
    const queue = await admin.open();
    expect(queue.find((q) => q.questionId === id)).toEqual({
      questionId: id,
      reason: "sample",
      kind: "estimate",
      stem: "How many writes per second can one Postgres box take?",
      answer: 10_000,
      unit: "writes per second",
      citation: "A single box takes about ten thousand writes per second.",
      articleTitle: "Postgres limits",
      sectionTitle: null,
      link: "https://docs.example.test/limits",
      validatorAnswer: null, // hand-written: no model checked it
    });
    expect(queue.find((q) => q.questionId === sampled)).toMatchObject({
      kind: "choice",
    });
    // P3-W13-S03b (Q-2): a generated estimate shows the validator's number.
    await trx
      .updateTable("question")
      .set({
        source_url: null,
        source_title: null,
        moment_id: sql<string>`(select moment_id from question where id = ${sampled})`,
        generator_model: "m",
        prompt_version: 1,
        content_hash: "h",
        validator_model: "v",
        validator_estimate: 9_000,
        validated_at: sql<Date>`now()`,
      })
      .where("id", "=", id)
      .execute();
    expect((await admin.open()).find((q) => q.questionId === id)).toMatchObject(
      {
        kind: "estimate",
        validatorAnswer: 9_000,
      },
    );
    expect(await admin.decide(id, "retire", "admin-1")).toBe(true);
    const row = await trx
      .selectFrom("question")
      .select("status")
      .where("id", "=", id)
      .executeTakeFirstOrThrow();
    expect(row.status).toBe("retired");
  });
});

test("the shape: an estimate has no options, a choice has no answer", async () => {
  await inRollback(async (trx) => {
    const insert = (values: Record<string, unknown>) =>
      sql`savepoint s`
        .execute(trx)
        .then(() =>
          trx
            .insertInto("question")
            .values({
              ordinal: 0,
              stem: "s",
              citation: "c",
              source_url: "https://docs.example.test/x",
              source_title: "x",
              status: "live",
              ...values,
            })
            .execute(),
        )
        .finally(() => sql`rollback to savepoint s`.execute(trx));
    await expect(
      insert({
        kind: "estimate",
        answer: 1,
        unit: "ms",
        options: ["a", "b", "c", "d"],
        correct: 0,
      }),
    ).rejects.toThrow(/question_shape/);
    await expect(
      insert({ kind: "estimate", answer: 0, unit: "ms" }),
    ).rejects.toThrow(/question_shape/);
    await expect(
      insert({ kind: "choice", answer: 1, unit: "ms" }),
    ).rejects.toThrow(/question_shape/);
    // Hand-written means no model; a model's question has no source page.
    await expect(
      insert({ kind: "estimate", answer: 1, unit: "ms", generator_model: "m" }),
    ).rejects.toThrow(/question_hand_written/);
  });
});

test("a book chapter's question never reaches the review queue, even with a review open", async () => {
  await inRollback(async (trx) => {
    const user = await trx
      .selectFrom("app_user")
      .select("id")
      .limit(1)
      .executeTakeFirstOrThrow();
    const book = await trx
      .insertInto("book")
      .values({
        user_id: user.id,
        title: "Private",
        file_key: `books/${user.id}/${randomUUID()}.pdf`,
        size_bytes: 100,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    const chapter = await trx
      .insertInto("book_chapter")
      .values({ book_id: book.id, ordinal: 0, title: "Mine" })
      .returning("id")
      .executeTakeFirstOrThrow();
    const q = await trx
      .insertInto("question")
      .values({
        book_chapter_id: chapter.id,
        ordinal: 0,
        stem: "From my book?",
        options: ["a", "b", "c", "d"],
        correct: 0,
        citation: "my private text",
        status: "flagged",
        generator_model: "m",
        prompt_version: 1,
        content_hash: "h",
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    await trx
      .insertInto("question_review")
      .values({ question_id: q.id, reason: "flagged" })
      .execute();
    const queue = await kyselyAdminQuestions(trx).open();
    expect(queue.some((r) => r.questionId === q.id)).toBe(false);
  });
});
