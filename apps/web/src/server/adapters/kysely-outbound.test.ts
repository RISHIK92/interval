import { randomUUID } from "node:crypto";
import type { DB } from "@interval/db";
import { sql, type Transaction } from "kysely";
import { afterAll, expect, test } from "vitest";
import { createDb } from "./kysely";
import { kyselyOutboundLinks } from "./kysely-outbound";

// Where a card's link goes (P1-W5-S01): always looked up by id, never taken from input.
const connectionString = process.env["DATABASE_URL"];
if (connectionString === undefined) {
  throw new Error("DATABASE_URL is not set; copy .env.example to .env");
}
const db = createDb(connectionString);

afterAll(async () => {
  await db.destroy();
});

class Rollback extends Error {}

type Seeded = {
  sourceId: string;
  itemId: string;
  otherItemId: string;
};

async function inRollback(
  body: (trx: Transaction<DB>, seeded: Seeded) => Promise<void>,
): Promise<void> {
  await expect(
    db.transaction().execute(async (trx) => {
      const source = await trx
        .insertInto("source")
        .values({
          name: `out-${randomUUID()}`,
          feed_url: "https://out.example.test/feed.xml",
          rights_profile: "full_text_internal",
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      const [item, other] = await trx
        .insertInto("content_item")
        .values([
          {
            source_id: source.id,
            guid: "out-1",
            canonical_url: "https://out.example.test/post",
            title: "Post",
          },
          {
            source_id: source.id,
            guid: "out-2",
            canonical_url: "https://out.example.test/other",
            title: "Other",
          },
        ])
        .returning("id")
        .execute();
      if (item === undefined || other === undefined) throw new Error("seed");
      await body(trx, {
        sourceId: source.id,
        itemId: item.id,
        otherItemId: other.id,
      });
      throw new Rollback();
    }),
  ).rejects.toBeInstanceOf(Rollback);
}

// ADR-0058: every link is the article's own page, under any rights profile (a link is
// never a copy, §3.2).
test("an article goes to its page, whatever its source's rights", async () => {
  await inRollback(async (trx, { sourceId, itemId, otherItemId }) => {
    const links = kyselyOutboundLinks(trx);
    expect(await links.resolve(itemId)).toEqual({
      url: "https://out.example.test/post",
      linkType: "article",
    });
    await trx
      .updateTable("source")
      .set({ rights_profile: "metadata_only" })
      .where("id", "=", sourceId)
      .execute();
    expect(await links.resolve(otherItemId)).toEqual({
      url: "https://out.example.test/other",
      linkType: "article",
    });
  });
});

test("an item that doesn't exist resolves to nothing", async () => {
  await inRollback(async (trx) => {
    expect(await kyselyOutboundLinks(trx).resolve("999999999999")).toBeNull();
  });
});

// ADR-0018: what the in-app reader shows around the framed page.
async function readerUser(trx: Transaction<DB>): Promise<string> {
  const code = await trx
    .insertInto("invite_code")
    .values({
      code: `OUT${randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase()}`,
      beta_group: "student",
      max_uses: 1,
      expires_at: sql<Date>`now() + interval '1 day'`,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  const id = randomUUID();
  await trx
    .insertInto("app_user")
    .values({
      id,
      name: "n",
      email: `${id}@example.test`,
      beta_group: "student",
      invite_code_id: code.id,
    })
    .execute();
  return id;
}

test("the reader gets the link, titles, reasons, save, minutes and the article's state", async () => {
  await inRollback(async (trx, { itemId }) => {
    const userId = await readerUser(trx);
    await trx
      .updateTable("content_item")
      .set({ frameable: true })
      .where("id", "=", itemId)
      .execute();
    await trx
      .insertInto("content_item_section")
      .values([
        { content_item_id: itemId, ordinal: 0, word_count: 500 },
        { content_item_id: itemId, ordinal: 1, word_count: 400 },
      ])
      .execute();
    await trx
      .insertInto("user_feed_entry")
      .values({
        user_id: userId,
        content_item_id: itemId,
        rank: 1,
        top_signal: "topic_match",
        reasons: "Good prep for system design interviews: Caching.",
      })
      .execute();
    await trx
      .insertInto("user_save")
      .values({ user_id: userId, content_item_id: itemId })
      .execute();
    const links = kyselyOutboundLinks(trx);
    const source = await trx
      .selectFrom("source as s")
      .innerJoin("content_item as c", "c.source_id", "s.id")
      .select("s.name")
      .where("c.id", "=", itemId)
      .executeTakeFirstOrThrow();
    expect(await links.reader(userId, itemId)).toEqual({
      link: { url: "https://out.example.test/post", linkType: "article" },
      frameable: true,
      articleTitle: "Post",
      sourceName: source.name,
      reasons: "Good prep for system design interviews: Caching.",
      saved: true,
      state: "unread",
      // 900 words at 230 a minute (Q-P1-39).
      estimatedMinutes: 4,
    });
    await trx
      .insertInto("user_article_opened")
      .values({ user_id: userId, content_item_id: itemId })
      .execute();
    expect((await links.reader(userId, itemId))?.state).toBe(
      "continue_reading",
    );
    await trx
      .insertInto("user_article_finished")
      .values({ user_id: userId, content_item_id: itemId, method: "mark_done" })
      .execute();
    expect((await links.reader(userId, itemId))?.state).toBe("completed");
  });
});

test("the reader says unknown frameability is not frameable, and nothing for no item", async () => {
  await inRollback(async (trx, { itemId }) => {
    const userId = await readerUser(trx);
    const links = kyselyOutboundLinks(trx);
    expect(await links.reader(userId, itemId)).toMatchObject({
      frameable: false,
      reasons: null,
      saved: false,
      estimatedMinutes: null,
    });
    expect(await links.reader(userId, "999999999999")).toBeNull();
  });
});
