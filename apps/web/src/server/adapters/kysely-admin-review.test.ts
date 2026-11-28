import { randomUUID } from "node:crypto";
import type { DB } from "@interval/db";
import type { Transaction } from "kysely";
import { afterAll, expect, test } from "vitest";
import { createDb } from "./kysely";
import { kyselyAdminReview } from "./kysely-admin-review";

// ING-6, P1-W3-S05 against the real schema; every case runs in a rolled-back
// transaction.
const connectionString = process.env["DATABASE_URL"];
if (connectionString === undefined) throw new Error("DATABASE_URL is not set");
const db = createDb(connectionString);

afterAll(async () => {
  await db.destroy();
});

class Rollback extends Error {}

async function rolledBack(body: (trx: Transaction<DB>) => Promise<void>) {
  await expect(
    db.transaction().execute(async (trx) => {
      await body(trx);
      throw new Rollback();
    }),
  ).rejects.toBeInstanceOf(Rollback);
}

async function seed(trx: Transaction<DB>): Promise<string> {
  const tag = randomUUID().slice(0, 8);
  const source = await trx
    .insertInto("source")
    .values({
      name: `review-${tag}`,
      feed_url: `https://review-${tag}.example.test/feed`,
      rights_profile: "full_text_internal",
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  const item = await trx
    .insertInto("content_item")
    .values({
      source_id: source.id,
      guid: `review-${tag}`,
      canonical_url: `https://review-${tag}.example.test/wal`,
      title: "WAL",
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  await trx
    .insertInto("content_item_section")
    .values([
      {
        content_item_id: item.id,
        ordinal: 0,
        heading: null,
        level: null,
        word_count: 80,
      },
      {
        content_item_id: item.id,
        ordinal: 1,
        heading: "Setup",
        level: 2,
        word_count: 400,
      },
    ])
    .execute();
  const concept = await trx
    .insertInto("concept")
    .values({ slug: `review-wal-${tag}`, name: "WAL", topic: "databases" })
    .returning(["id", "slug"])
    .executeTakeFirstOrThrow();
  await trx
    .insertInto("item_tagging")
    .values({
      content_item_id: item.id,
      difficulty: "intermediate",
      model: "m",
      prompt_version: 1,
    })
    .execute();
  await trx
    .insertInto("item_concept")
    .values({ content_item_id: item.id, concept_id: concept.id })
    .execute();
  return item.id;
}

test("an item reads back with its sections and the model's tags", async () => {
  await rolledBack(async (trx) => {
    const id = await seed(trx);
    const item = await kyselyAdminReview(trx).item(id);
    expect(item?.sections.map((s) => s.heading)).toEqual([null, "Setup"]);
    expect(item?.modelTags?.difficulty).toBe("intermediate");
    expect(item?.modelTags?.concepts).toHaveLength(1);
    expect(item?.tagOverride).toBeNull();
    expect(await kyselyAdminReview(trx).item("999999999999")).toBeNull();
    expect(await kyselyAdminReview(trx).item("not-a-number")).toBeNull();
  });
});

// ADR-0058: the whole article's override only; a section's row left from before is
// neither read nor touched (stage C folds it in).
test("the article's override is written, replaced and cleared", async () => {
  await rolledBack(async (trx) => {
    const id = await seed(trx);
    const review = kyselyAdminReview(trx);
    await trx
      .insertInto("tag_override")
      .values({
        content_item_id: id,
        heading: "Setup",
        difficulty: "advanced",
        concepts: [],
        updated_by: "admin-0",
      })
      .execute();
    await review.setTags(
      id,
      { difficulty: "advanced", concepts: [] },
      "admin-1",
    );
    await review.setTags(
      id,
      { difficulty: "beginner", concepts: [] },
      "admin-2",
    );
    expect((await review.item(id))?.tagOverride).toEqual({
      difficulty: "beginner",
      concepts: [],
    });
    await review.setTags(id, null, "admin-1");
    expect((await review.item(id))?.tagOverride).toBeNull();
    expect(
      await trx
        .selectFrom("tag_override")
        .select("heading")
        .where("content_item_id", "=", id)
        .execute(),
    ).toEqual([{ heading: "Setup" }]);
    expect(await review.recent(500)).toEqual(
      expect.arrayContaining([expect.objectContaining({ id, reports: [] })]),
    );
  });
});

test("only concepts not retired can be tagged", async () => {
  await rolledBack(async (trx) => {
    const tag = randomUUID().slice(0, 8);
    await trx
      .insertInto("concept")
      .values([
        { slug: `live-${tag}`, name: "Live", topic: "backend" },
        {
          slug: `gone-${tag}`,
          name: "Gone",
          topic: "backend",
          retired_at: new Date(),
        },
      ])
      .execute();
    const active = await kyselyAdminReview(trx).activeConcepts();
    expect(active).toContain(`live-${tag}`);
    expect(active).not.toContain(`gone-${tag}`);
  });
});
