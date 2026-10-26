import { randomUUID } from "node:crypto";
import type { DB } from "@interval/db";
import { sql, type Transaction } from "kysely";
import { afterAll, expect, test } from "vitest";
import { createDb } from "./kysely";
import { kyselyLibrary } from "./kysely-library";

// Saves and history (§5I, P1-W5-S04): ids, titles and sources only, never text.
const connectionString = process.env["DATABASE_URL"];
if (connectionString === undefined) {
  throw new Error("DATABASE_URL is not set; copy .env.example to .env");
}
const db = createDb(connectionString);

afterAll(async () => {
  await db.destroy();
});

class Rollback extends Error {}

type Seeded = { userId: string; items: string[]; moments: string[][] };

async function inRollback(
  body: (trx: Transaction<DB>, seeded: Seeded) => Promise<void>,
): Promise<void> {
  await expect(
    db.transaction().execute(async (trx) => {
      const source = await trx
        .insertInto("source")
        .values({
          name: `lib-${randomUUID()}`,
          feed_url: "https://lib.example.test/feed.xml",
          rights_profile: "full_text_internal",
          moments_seeded: true,
          moments_enabled: true,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      const items: string[] = [];
      const moments: string[][] = [];
      for (const n of [1, 2]) {
        const item = await trx
          .insertInto("content_item")
          .values({
            source_id: source.id,
            guid: `lib-${String(n)}`,
            canonical_url: `https://lib.example.test/${String(n)}`,
            title: `Article ${String(n)}`,
            feed_summary: "SUMMARY TEXT MUST NOT APPEAR",
          })
          .returning("id")
          .executeTakeFirstOrThrow();
        const rows = await trx
          .insertInto("moment")
          .values(
            [0, 1, 2, 3].map((ordinal) => ({
              content_item_id: item.id,
              ordinal,
              title: `s${String(ordinal)}`,
              estimated_minutes: 3,
              link: `https://lib.example.test/${String(n)}#s${String(ordinal)}`,
              link_type: "anchor" as const,
            })),
          )
          .returning("id")
          .execute();
        items.push(item.id);
        moments.push(rows.map((r) => r.id));
      }
      const code = await trx
        .insertInto("invite_code")
        .values({
          code: `LIB${randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`,
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
      await body(trx, { userId, items, moments });
      throw new Rollback();
    }),
  ).rejects.toBeInstanceOf(Rollback);
}

test("saves list newest first, with title and source only", async () => {
  await inRollback(async (trx, { userId, items }) => {
    const [first, second] = items;
    if (first === undefined || second === undefined) throw new Error("seed");
    await trx
      .insertInto("user_save")
      .values([
        {
          user_id: userId,
          content_item_id: first,
          saved_at: sql<Date>`now() - interval '1 day'`,
        },
        { user_id: userId, content_item_id: second },
      ])
      .execute();
    const saves = await kyselyLibrary(trx).saves(userId, 10);
    expect(saves.map((s) => s.itemId)).toEqual([second, first]);
    expect(Object.keys(saves[0] ?? {}).sort()).toEqual([
      "articleTitle",
      "itemId",
      "linkBroken",
      "savedAt",
      "sourceName",
    ]);
    expect(JSON.stringify(saves)).not.toContain("SUMMARY TEXT");
  });
});

test("history lists articles with a finished section, newest first, and how far", async () => {
  await inRollback(async (trx, { userId, items, moments }) => {
    const [first, second] = items;
    const [firstMoments, secondMoments] = moments;
    if (!first || !second || !firstMoments || !secondMoments)
      throw new Error("seed");
    // Article 1: two of four sections, a day ago. Article 2: all four, just now.
    await trx
      .insertInto("user_moment_finished")
      .values([
        ...firstMoments.slice(0, 2).map((moment_id) => ({
          user_id: userId,
          moment_id,
          method: "mark_done" as const,
          finished_at: sql<Date>`now() - interval '1 day'`,
        })),
        ...secondMoments.map((moment_id) => ({
          user_id: userId,
          moment_id,
          method: "return_prompt" as const,
        })),
      ])
      .execute();
    const history = await kyselyLibrary(trx).history(userId, 10);
    expect(
      history.map(({ itemId, finishedSections, totalSections, finished }) => ({
        itemId,
        finishedSections,
        totalSections,
        finished,
      })),
    ).toEqual([
      { itemId: second, finishedSections: 4, totalSections: 4, finished: true },
      { itemId: first, finishedSections: 2, totalSections: 4, finished: false },
    ]);
    expect(history[0]?.articleTitle).toBe("Article 2");
    expect(JSON.stringify(history)).not.toContain("SUMMARY TEXT");
    expect(await kyselyLibrary(trx).history(userId, 1)).toHaveLength(1);
  });
});

test("a whole article finished is in history as finished", async () => {
  await inRollback(async (trx, { userId, items }) => {
    const [first] = items;
    if (first === undefined) throw new Error("seed");
    await trx
      .insertInto("user_article_finished")
      .values({ user_id: userId, content_item_id: first, method: "mark_done" })
      .execute();
    const [entry] = await kyselyLibrary(trx).history(userId, 10);
    expect(entry).toMatchObject({ itemId: first, finished: true });
  });
});

test("sections and the whole article finished: one row, finished, at the later time", async () => {
  await inRollback(async (trx, { userId, items, moments }) => {
    const [first, second] = items;
    const [firstMoments] = moments;
    if (!first || !second || !firstMoments) throw new Error("seed");
    await trx
      .insertInto("user_moment_finished")
      .values(
        firstMoments.slice(0, 2).map((moment_id) => ({
          user_id: userId,
          moment_id,
          method: "mark_done" as const,
          finished_at: sql<Date>`now() - interval '1 day'`,
        })),
      )
      .execute();
    await trx
      .insertInto("user_article_finished")
      .values([
        { user_id: userId, content_item_id: first, method: "mark_done" },
        {
          user_id: userId,
          content_item_id: second,
          method: "mark_done",
          finished_at: sql<Date>`now() - interval '1 hour'`,
        },
      ])
      .execute();
    const history = await kyselyLibrary(trx).history(userId, 10);
    expect(history.map((h) => h.itemId)).toEqual([first, second]);
    expect(history[0]).toMatchObject({
      finishedSections: 2,
      totalSections: 4,
      finished: true,
    });
  });
});

test("an article with no sections, finished whole, is finished", async () => {
  await inRollback(async (trx, { userId, items }) => {
    const [first] = items;
    if (first === undefined) throw new Error("seed");
    const item = await trx
      .selectFrom("content_item")
      .select("source_id")
      .where("id", "=", first)
      .executeTakeFirstOrThrow();
    const bare = await trx
      .insertInto("content_item")
      .values({
        source_id: item.source_id,
        guid: "lib-bare",
        canonical_url: "https://lib.example.test/bare",
        title: "Bare",
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    await trx
      .insertInto("user_article_finished")
      .values({
        user_id: userId,
        content_item_id: bare.id,
        method: "mark_done",
      })
      .execute();
    const [entry] = await kyselyLibrary(trx).history(userId, 10);
    expect(entry).toMatchObject({
      itemId: bare.id,
      finishedSections: 0,
      totalSections: 0,
      finished: true,
    });
  });
});

test("saves and history say when an item's link broke (P1-W6-S03)", async () => {
  await inRollback(async (trx, { userId, items }) => {
    const [first] = items;
    if (first === undefined) throw new Error("seed");
    await trx
      .insertInto("user_save")
      .values({ user_id: userId, content_item_id: first })
      .execute();
    await trx
      .insertInto("user_article_finished")
      .values({ user_id: userId, content_item_id: first, method: "mark_done" })
      .execute();
    const library = kyselyLibrary(trx);
    expect((await library.saves(userId, 10))[0]?.linkBroken).toBe(false);
    await trx
      .updateTable("content_item")
      .set({ link_broken_at: new Date() })
      .where("id", "=", first)
      .execute();
    expect((await library.saves(userId, 10))[0]?.linkBroken).toBe(true);
    expect((await library.history(userId, 10))[0]?.linkBroken).toBe(true);
  });
});
