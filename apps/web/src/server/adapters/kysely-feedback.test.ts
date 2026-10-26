import { randomUUID } from "node:crypto";
import type { DB } from "@interval/db";
import { sql, type Transaction } from "kysely";
import { afterAll, expect, test } from "vitest";
import { createDb } from "./kysely";
import { kyselyFeedback } from "./kysely-feedback";

// The feedback controls' writes (§5C, Q-P1-15, P1-W4-S07), each idempotent.
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
    seeded: { userId: string; itemId: string; sourceId: string },
  ) => Promise<void>,
): Promise<void> {
  await expect(
    db.transaction().execute(async (trx) => {
      const source = await trx
        .insertInto("source")
        .values({
          name: `fb-${randomUUID()}`,
          feed_url: "https://fb.example.test/feed.xml",
          rights_profile: "full_text_internal",
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      const item = await trx
        .insertInto("content_item")
        .values({
          source_id: source.id,
          guid: "fb-1",
          canonical_url: "https://fb.example.test/a",
          title: "A",
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      const code = await trx
        .insertInto("invite_code")
        .values({
          code: `FB${randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`,
          beta_group: "student",
          max_uses: 1,
          expires_at: sql<Date>`now() + interval '1 day'`,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      const userId = randomUUID();
      await trx
        .insertInto("app_user")
        .values({
          id: userId,
          name: "n",
          email: `${userId}@example.test`,
          beta_group: "student",
          invite_code_id: code.id,
        })
        .execute();
      await body(trx, { userId, itemId: item.id, sourceId: source.id });
      throw new Rollback();
    }),
  ).rejects.toBeInstanceOf(Rollback);
}

test("feedback is recorded once per kind; both More and Less can stand", async () => {
  await inRollback(async (trx, { userId, itemId }) => {
    const feedback = kyselyFeedback(trx);
    expect(await feedback.give(userId, itemId, "more_like_this")).toBe(true);
    expect(await feedback.give(userId, itemId, "more_like_this")).toBe(false);
    expect(await feedback.give(userId, itemId, "less_like_this")).toBe(true);
    const kinds = await trx
      .selectFrom("item_feedback")
      .select("kind")
      .where("user_id", "=", userId)
      .orderBy("kind")
      .execute();
    // In the enum's declared order.
    expect(kinds.map((k) => k.kind)).toEqual([
      "more_like_this",
      "less_like_this",
    ]);
  });
});

test("not interested can be undone, and only it", async () => {
  await inRollback(async (trx, { userId, itemId }) => {
    const feedback = kyselyFeedback(trx);
    await feedback.give(userId, itemId, "not_interested");
    await feedback.give(userId, itemId, "more_like_this");
    expect(await feedback.notInterested(userId, itemId)).toBe(true);
    expect(await feedback.undoNotInterested(userId, itemId)).toBe(true);
    expect(await feedback.undoNotInterested(userId, itemId)).toBe(false);
    expect(await feedback.notInterested(userId, itemId)).toBe(false);
    const left = await trx
      .selectFrom("item_feedback")
      .select("kind")
      .where("user_id", "=", userId)
      .execute();
    expect(left).toEqual([{ kind: "more_like_this" }]);
  });
});

test("hide source hides the item's source; save stores the item", async () => {
  await inRollback(async (trx, { userId, itemId, sourceId }) => {
    const feedback = kyselyFeedback(trx);
    expect(await feedback.hideSource(userId, itemId)).toBe(true);
    expect(await feedback.hideSource(userId, itemId)).toBe(false);
    expect(await feedback.save(userId, itemId)).toBe(true);
    expect(await feedback.save(userId, itemId)).toBe(false);
    const hidden = await trx
      .selectFrom("user_hidden_source")
      .select("source_id")
      .where("user_id", "=", userId)
      .execute();
    expect(hidden).toEqual([{ source_id: sourceId }]);
    const saved = await trx
      .selectFrom("user_save")
      .select(["user_id", "content_item_id"])
      .where("user_id", "=", userId)
      .execute();
    expect(saved).toEqual([{ user_id: userId, content_item_id: itemId }]);
  });
});

test("an item that doesn't exist changes nothing", async () => {
  await inRollback(async (trx, { userId }) => {
    const feedback = kyselyFeedback(trx);
    expect(await feedback.give(userId, "999999999999", "more_like_this")).toBe(
      false,
    );
    expect(await feedback.hideSource(userId, "999999999999")).toBe(false);
    expect(await feedback.save(userId, "999999999999")).toBe(false);
  });
});

// P1-W4-S08: the Profile page lists and resets what was inferred, and unhides sources.
test("hidden sources are listed and can be unhidden", async () => {
  await inRollback(async (trx, { userId, itemId, sourceId }) => {
    const feedback = kyselyFeedback(trx);
    expect(await feedback.hiddenSources(userId)).toEqual([]);
    await feedback.hideSource(userId, itemId);
    const [hidden] = await feedback.hiddenSources(userId);
    expect(hidden?.sourceId).toBe(sourceId);
    expect(hidden?.name).toMatch(/^fb-/);
    expect(await feedback.unhideSource(userId, sourceId)).toBe(true);
    expect(await feedback.unhideSource(userId, sourceId)).toBe(false);
    expect(await feedback.hiddenSources(userId)).toEqual([]);
  });
});

test("a reset clears More and Less like this and the concept down-rank only", async () => {
  await inRollback(async (trx, { userId, itemId }) => {
    const slug = `fb-c-${userId.slice(0, 8)}`;
    await trx
      .insertInto("concept")
      .values({ slug, name: "Write-ahead log", topic: "databases" })
      .execute();
    // An admin's item correction names the concepts the view reads.
    await trx
      .insertInto("tag_override")
      .values({
        content_item_id: itemId,
        heading: "",
        difficulty: "beginner",
        concepts: [slug],
        updated_by: "test",
      })
      .execute();
    const feedback = kyselyFeedback(trx);
    await feedback.give(userId, itemId, "more_like_this");
    await feedback.give(userId, itemId, "less_like_this");
    await feedback.give(userId, itemId, "not_interested");
    await feedback.save(userId, itemId);
    expect(await feedback.inferred(userId)).toEqual({
      more: [{ itemId, title: "A" }],
      less: [{ itemId, title: "A" }],
      avoidedConcepts: [{ slug, name: "Write-ahead log" }],
    });
    await feedback.resetInferred(userId);
    expect(await feedback.inferred(userId)).toEqual({
      more: [],
      less: [],
      avoidedConcepts: [],
    });
    // Not interested items stay hidden; saves stay (owner, 2026-10-26).
    expect(await feedback.notInterested(userId, itemId)).toBe(true);
    const saved = await trx
      .selectFrom("user_save")
      .select("content_item_id")
      .where("user_id", "=", userId)
      .execute();
    expect(saved).toHaveLength(1);
  });
});

// P1-W5-S04: Saved ✓ on the card unsaves.
test("unsave removes a save; a repeat changes nothing", async () => {
  await inRollback(async (trx, { userId, itemId }) => {
    const feedback = kyselyFeedback(trx);
    // Another user's save of the same item stays. Made here: the test must not
    // depend on who else is in the database.
    const mine = await trx
      .selectFrom("app_user")
      .select(["invite_code_id", "beta_group"])
      .where("id", "=", userId)
      .executeTakeFirstOrThrow();
    const otherId = randomUUID();
    await trx
      .insertInto("app_user")
      .values({
        id: otherId,
        name: "other",
        email: `${otherId}@example.test`,
        beta_group: mine.beta_group,
        invite_code_id: mine.invite_code_id,
      })
      .execute();
    await feedback.save(otherId, itemId);
    await feedback.save(userId, itemId);
    expect(await feedback.unsave(userId, itemId)).toBe(true);
    expect(await feedback.unsave(userId, itemId)).toBe(false);
    const left = await trx
      .selectFrom("user_save")
      .select("user_id")
      .where("content_item_id", "=", itemId)
      .execute();
    expect(left).toEqual([{ user_id: otherId }]);
  });
});
