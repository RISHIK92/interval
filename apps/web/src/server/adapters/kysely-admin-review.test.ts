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
      moments_enabled: true,
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
  const moments = await trx
    .insertInto("moment")
    .values([
      {
        content_item_id: item.id,
        ordinal: 0,
        title: "WAL",
        estimated_minutes: 1,
        link: "https://x.test/wal",
        link_type: "page_top",
      },
      {
        content_item_id: item.id,
        ordinal: 1,
        title: "Setup",
        estimated_minutes: 2,
        link: "https://x.test/wal#setup",
        link_type: "anchor",
      },
    ])
    .returning("id")
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
  const setupMoment = moments[1];
  if (setupMoment === undefined) throw new Error("no moment");
  await trx
    .insertInto("moment_tagging")
    .values({ moment_id: setupMoment.id, difficulty: "advanced" })
    .execute();
  return item.id;
}

test("an item reads back with its sections, moments and the model's tags", async () => {
  await rolledBack(async (trx) => {
    const id = await seed(trx);
    const item = await kyselyAdminReview(trx).item(id);
    expect(item?.sections.map((s) => s.heading)).toEqual([null, "Setup"]);
    expect(item?.moments.map((m) => m.heading)).toEqual([null, "Setup"]);
    expect(item?.modelTags.item?.difficulty).toBe("intermediate");
    expect(item?.modelTags.item?.concepts).toHaveLength(1);
    expect(item?.modelTags.moments.get(1)).toEqual({
      difficulty: "advanced",
      concepts: [],
    });
    expect(item?.boundaries).toBeNull();
    expect(await kyselyAdminReview(trx).item("999999999999")).toBeNull();
    expect(await kyselyAdminReview(trx).item("not-a-number")).toBeNull();
  });
});

test("overrides are written, replaced and cleared", async () => {
  await rolledBack(async (trx) => {
    const id = await seed(trx);
    const review = kyselyAdminReview(trx);
    await review.setBoundaries(id, ["Setup"], "admin-1");
    await review.setBoundaries(id, ["Setup", "Setup"], "admin-2");
    await review.setTags(
      id,
      "",
      { difficulty: "beginner", concepts: [] },
      "admin-1",
    );
    await review.setTags(
      id,
      "Setup",
      { difficulty: "advanced", concepts: [] },
      "admin-1",
    );
    let item = await review.item(id);
    expect(item?.boundaries).toEqual(["Setup", "Setup"]);
    expect(item?.tagOverrides.get("")).toEqual({
      difficulty: "beginner",
      concepts: [],
    });
    expect(item?.tagOverrides.get("Setup")?.difficulty).toBe("advanced");
    await review.setBoundaries(id, null, "admin-1");
    await review.setTags(id, "", null, "admin-1");
    item = await review.item(id);
    expect(item?.boundaries).toBeNull();
    expect(item?.tagOverrides.has("")).toBe(false);
    expect(await review.recent(500)).toEqual(
      expect.arrayContaining([expect.objectContaining({ id, momentCount: 2 })]),
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
