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

type Seeded = { userId: string; items: string[] };

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
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      const items: string[] = [];
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
        items.push(item.id);
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
      await body(trx, { userId, items });
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
      "frameable",
      "itemId",
      "linkBroken",
      "savedAt",
      "sourceName",
      "state",
    ]);
    expect(JSON.stringify(saves)).not.toContain("SUMMARY TEXT");
  });
});

// ADR-0058: an article's state is all the Library says of how far: unread, Continue
// reading (opened), or Completed; in-app when framable (ADR-0018).
test("saves say each article's state, and if it can be framed", async () => {
  await inRollback(async (trx, { userId, items }) => {
    const [first, second] = items;
    if (first === undefined || second === undefined) throw new Error("seed");
    await trx
      .insertInto("user_save")
      .values([
        { user_id: userId, content_item_id: first },
        {
          user_id: userId,
          content_item_id: second,
          saved_at: sql<Date>`now() - interval '1 day'`,
        },
      ])
      .execute();
    await trx
      .updateTable("content_item")
      .set({ frameable: true })
      .where("id", "=", first)
      .execute();
    const library = kyselyLibrary(trx);
    const states = async () =>
      (await library.saves(userId, 10)).map((r) => [r.itemId, r.state]);
    expect(await states()).toEqual([
      [first, "unread"],
      [second, "unread"],
    ]);
    expect((await library.saves(userId, 10)).map((r) => r.frameable)).toEqual([
      true,
      false,
    ]);
    await trx
      .insertInto("user_article_opened")
      .values([
        { user_id: userId, content_item_id: first },
        { user_id: userId, content_item_id: second },
      ])
      .execute();
    await trx
      .insertInto("user_article_finished")
      .values({ user_id: userId, content_item_id: second, method: "mark_done" })
      .execute();
    expect(await states()).toEqual([
      [first, "continue_reading"],
      [second, "completed"],
    ]);
  });
});

test("history lists opened and completed articles, newest read first", async () => {
  await inRollback(async (trx, { userId, items }) => {
    const [first, second] = items;
    if (first === undefined || second === undefined) throw new Error("seed");
    const library = kyselyLibrary(trx);
    expect(await library.history(userId, 10)).toEqual([]);
    await trx
      .insertInto("user_article_opened")
      .values([
        {
          user_id: userId,
          content_item_id: first,
          opened_at: sql<Date>`now() - interval '1 hour'`,
        },
        {
          user_id: userId,
          content_item_id: second,
          opened_at: sql<Date>`now() - interval '3 days'`,
        },
      ])
      .execute();
    // Completed after it was opened: its completion is when it was last read.
    await trx
      .insertInto("user_article_finished")
      .values({
        user_id: userId,
        content_item_id: second,
        method: "mark_done",
        finished_at: sql<Date>`now() - interval '1 minute'`,
      })
      .execute();
    const history = await library.history(userId, 10);
    expect(history.map(({ itemId, state }) => ({ itemId, state }))).toEqual([
      { itemId: second, state: "completed" },
      { itemId: first, state: "continue_reading" },
    ]);
    expect(JSON.stringify(history)).not.toContain("SUMMARY TEXT");
    expect(await library.history(userId, 1)).toHaveLength(1);
  });
});

// ADR-0058: an article opened again was read then, so it moves up in history, though
// its first open stays as it was.
test("a reopened article moves up in history", async () => {
  await inRollback(async (trx, { userId, items }) => {
    const [first, second] = items;
    if (first === undefined || second === undefined) throw new Error("seed");
    await trx
      .insertInto("user_article_opened")
      .values([
        {
          user_id: userId,
          content_item_id: first,
          opened_at: sql<Date>`now() - interval '1 hour'`,
          last_opened_at: sql<Date>`now() - interval '1 hour'`,
        },
        {
          user_id: userId,
          content_item_id: second,
          opened_at: sql<Date>`now() - interval '3 days'`,
          last_opened_at: sql<Date>`now() - interval '1 minute'`,
        },
      ])
      .execute();
    const history = await kyselyLibrary(trx).history(userId, 10);
    expect(history.map((h) => h.itemId)).toEqual([second, first]);
  });
});

// A completion with no open row (completed before opens were kept) is still history.
test("a completed article without an open is in history as completed", async () => {
  await inRollback(async (trx, { userId, items }) => {
    const [first] = items;
    if (first === undefined) throw new Error("seed");
    await trx
      .insertInto("user_article_finished")
      .values({ user_id: userId, content_item_id: first, method: "mark_done" })
      .execute();
    const [entry] = await kyselyLibrary(trx).history(userId, 10);
    expect(entry).toMatchObject({
      itemId: first,
      articleTitle: "Article 1",
      state: "completed",
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
