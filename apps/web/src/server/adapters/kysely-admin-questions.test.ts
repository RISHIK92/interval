import { randomUUID } from "node:crypto";
import type { DB } from "@interval/db";
import type { Transaction } from "kysely";
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
