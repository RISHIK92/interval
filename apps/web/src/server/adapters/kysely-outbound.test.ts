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
  momentId: string;
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
          moments_seeded: true,
          moments_enabled: true,
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
      const moment = await trx
        .insertInto("moment")
        .values({
          content_item_id: item.id,
          ordinal: 0,
          title: "Raft",
          estimated_minutes: 3,
          link: "https://out.example.test/post#raft",
          link_type: "anchor",
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      await body(trx, {
        sourceId: source.id,
        itemId: item.id,
        otherItemId: other.id,
        momentId: moment.id,
      });
      throw new Rollback();
    }),
  ).rejects.toBeInstanceOf(Rollback);
}

test("a moment goes to its section; the article to its page", async () => {
  await inRollback(async (trx, { itemId, momentId }) => {
    const links = kyselyOutboundLinks(trx);
    expect(await links.resolve(itemId, momentId)).toEqual({
      url: "https://out.example.test/post#raft",
      linkType: "anchor",
    });
    expect(await links.resolve(itemId, null)).toEqual({
      url: "https://out.example.test/post",
      linkType: "article",
    });
  });
});

test("a moment of another article, or one whose source no longer allows moments, goes to the page", async () => {
  await inRollback(async (trx, { sourceId, itemId, otherItemId, momentId }) => {
    const links = kyselyOutboundLinks(trx);
    expect(await links.resolve(otherItemId, momentId)).toEqual({
      url: "https://out.example.test/other",
      linkType: "article",
    });
    await trx
      .updateTable("source")
      .set({ moments_enabled: false, moments_switched_off: true })
      .where("id", "=", sourceId)
      .execute();
    const moment = await links.resolve(itemId, momentId);
    // The purge trigger deletes the moments when moments go off, so this checks the
    // fallback; the adapter's own rights check matches user_feed_visible's.
    expect(moment).toEqual({
      url: "https://out.example.test/post",
      linkType: "article",
    });
  });
});

test("an item that doesn't exist resolves to nothing", async () => {
  await inRollback(async (trx) => {
    expect(
      await kyselyOutboundLinks(trx).resolve("999999999999", null),
    ).toBeNull();
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

test("the reader gets the link, titles, the user's note and save, and the next section", async () => {
  await inRollback(async (trx, { itemId, momentId }) => {
    const userId = await readerUser(trx);
    await trx
      .updateTable("content_item")
      .set({ frameable: true })
      .where("id", "=", itemId)
      .execute();
    const next = await trx
      .insertInto("moment")
      .values({
        content_item_id: itemId,
        ordinal: 1,
        title: "Paxos",
        estimated_minutes: 4,
        link: "https://out.example.test/post#paxos",
        link_type: "anchor",
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    await trx
      .insertInto("user_feed_entry")
      .values({
        user_id: userId,
        chip: "3-8",
        content_item_id: itemId,
        moment_id: momentId,
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
    expect(await links.reader(userId, itemId, momentId)).toEqual({
      link: { url: "https://out.example.test/post#raft", linkType: "anchor" },
      frameable: true,
      articleTitle: "Post",
      sectionTitle: "Raft",
      sourceName: source.name,
      reasons: "Good prep for system design interviews: Caching.",
      saved: true,
      nextMomentId: next.id,
    });
    // The last section has no next; it has no feed entry, so no reasons.
    expect(await links.reader(userId, itemId, next.id)).toMatchObject({
      sectionTitle: "Paxos",
      reasons: null,
      nextMomentId: null,
    });
    // The whole article: no section, so no next either.
    expect(await links.reader(userId, itemId, null)).toMatchObject({
      link: { url: "https://out.example.test/post", linkType: "article" },
      sectionTitle: null,
      nextMomentId: null,
    });
  });
});

test("the reader says unknown frameability is not frameable, and nothing for no item", async () => {
  await inRollback(async (trx, { itemId }) => {
    const userId = await readerUser(trx);
    const links = kyselyOutboundLinks(trx);
    expect(await links.reader(userId, itemId, null)).toMatchObject({
      frameable: false,
      reasons: null,
      saved: false,
    });
    expect(await links.reader(userId, "999999999999", null)).toBeNull();
  });
});
