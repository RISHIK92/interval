import { randomUUID } from "node:crypto";
import type { DB } from "@interval/db";
import { type KyselyPlugin, sql, type Transaction } from "kysely";
import { afterAll, afterEach, expect, test, vi } from "vitest";
import { createDb, kyselyFeedReader, toCard } from "./kysely";

const connectionString = process.env["DATABASE_URL"];
if (connectionString === undefined) {
  throw new Error("DATABASE_URL is not set; copy .env.example to .env");
}
const db = createDb(connectionString);

afterAll(async () => {
  await db.destroy();
});

afterEach(() => {
  vi.restoreAllMocks();
});

class Rollback extends Error {}

type Seeded = {
  userId: string;
  otherId: string;
  itemId: string;
  momentIds: string[];
};

// One source, one item with two moments, and two users (P1-W4-S04).
async function seed(trx: Transaction<DB>): Promise<Seeded> {
  const source = await trx
    .insertInto("source")
    .values({
      name: "webfeed-test",
      feed_url: "https://webfeed.example.test/feed.xml",
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
      guid: "g1",
      canonical_url: "https://webfeed.example.test/post",
      title: "Consensus in practice",
      author: "Rae Writer",
      feed_summary: "SUMMARY TEXT MUST NOT APPEAR",
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  const moments = await trx
    .insertInto("moment")
    .values([
      {
        content_item_id: item.id,
        ordinal: 0,
        title: "Why consensus",
        estimated_minutes: 2,
        link: "https://webfeed.example.test/post",
        link_type: "page_top",
      },
      {
        content_item_id: item.id,
        ordinal: 1,
        title: "Raft in one page",
        estimated_minutes: 3,
        link: "https://webfeed.example.test/post#raft",
        link_type: "anchor",
      },
    ])
    .returning("id")
    .execute();
  const code = await trx
    .insertInto("invite_code")
    .values({
      code: `WEBFEED${randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase()}`,
      beta_group: "student",
      max_uses: 2,
      expires_at: sql<Date>`now() + interval '1 day'`,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  const [userId, otherId] = [randomUUID(), randomUUID()];
  for (const id of [userId, otherId]) {
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
  }
  return {
    userId,
    otherId,
    itemId: item.id,
    momentIds: moments.map((m) => m.id),
  };
}

async function inRollback(
  body: (trx: Transaction<DB>, seeded: Seeded) => Promise<void>,
): Promise<void> {
  await expect(
    db.transaction().execute(async (trx) => {
      await body(trx, await seed(trx));
      throw new Rollback();
    }),
  ).rejects.toBeInstanceOf(Rollback);
}

test("a feed never computed reads as not computed", async () => {
  await inRollback(async (trx, { userId }) => {
    expect(await kyselyFeedReader(trx).read(userId, "3-8", 50)).toEqual({
      computed: false,
      cards: [],
    });
  });
});

test("read returns the user's own cards in rank order, in one query", async () => {
  let queries = 0;
  const counting: KyselyPlugin = {
    transformQuery: ({ node }) => {
      queries += 1;
      return node;
    },
    transformResult: ({ result }) => Promise.resolve(result),
  };
  await inRollback(async (trx, { userId, otherId, itemId, momentIds }) => {
    const [first, second] = momentIds;
    if (first === undefined || second === undefined) throw new Error("seed");
    // Only the second section is in this user's 3-8 feed; the count still covers
    // both. Another chip's entries and another user's stay out.
    await trx
      .insertInto("user_feed_entry")
      .values([
        {
          user_id: userId,
          chip: "3-8",
          content_item_id: itemId,
          moment_id: second,
          rank: 1,
          top_signal: "topic_match",
        },
        {
          user_id: userId,
          chip: "1-3",
          content_item_id: itemId,
          moment_id: first,
          rank: 1,
          top_signal: "time_fit",
        },
        {
          user_id: otherId,
          chip: "3-8",
          content_item_id: itemId,
          moment_id: first,
          rank: 1,
          top_signal: "quality",
        },
      ])
      .execute();
    await trx
      .insertInto("user_feed_state")
      .values([
        { user_id: userId, computed_at: new Date() },
        { user_id: otherId, computed_at: new Date() },
      ])
      .execute();
    const result = await kyselyFeedReader(trx.withPlugin(counting)).read(
      userId,
      "3-8",
      50,
    );
    expect(queries).toBe(1);
    expect(result).toEqual({
      computed: true,
      cards: [
        {
          kind: "moment",
          itemId,
          momentId: second,
          sectionTitle: "Raft in one page",
          sectionNumber: 2,
          sectionCount: 2,
          estimatedMinutes: 3,
          articleTitle: "Consensus in practice",
          author: "Rae Writer",
          sourceName: "webfeed-test",
          note: null,
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain("SUMMARY TEXT");
  });
});

// P1-W4-S05b: 8-15 holds whole articles too; an article has no moment, and its length
// is unknown without stored sections (Q-P1-39).
test("a whole article reads as an article card, before or after moments", async () => {
  await inRollback(async (trx, { userId, itemId, momentIds }) => {
    const [first] = momentIds;
    if (first === undefined) throw new Error("seed");
    await trx
      .insertInto("user_feed_entry")
      .values([
        {
          user_id: userId,
          chip: "8-15",
          content_item_id: itemId,
          moment_id: null,
          rank: 1,
          top_signal: "time_fit",
        },
        {
          user_id: userId,
          chip: "8-15",
          content_item_id: itemId,
          moment_id: first,
          rank: 2,
          top_signal: "quality",
        },
      ])
      .execute();
    await trx
      .insertInto("user_feed_state")
      .values({ user_id: userId, computed_at: new Date() })
      .execute();
    const { computed, cards } = await kyselyFeedReader(trx).read(
      userId,
      "8-15",
      50,
    );
    expect(computed).toBe(true);
    expect(cards[0]).toEqual({
      kind: "article",
      itemId,
      estimatedMinutes: null,
      articleTitle: "Consensus in practice",
      author: "Rae Writer",
      sourceName: "webfeed-test",
      note: null,
    });
    expect(cards.map((c) => c.kind)).toEqual(["article", "moment"]);
  });
});

test("a computed but empty chip reads as computed with no cards", async () => {
  await inRollback(async (trx, { userId, itemId, momentIds }) => {
    const [first] = momentIds;
    if (first === undefined) throw new Error("seed");
    await trx
      .insertInto("user_feed_entry")
      .values({
        user_id: userId,
        chip: "3-8",
        content_item_id: itemId,
        moment_id: first,
        rank: 1,
        top_signal: "quality",
      })
      .execute();
    await trx
      .insertInto("user_feed_state")
      .values({ user_id: userId, computed_at: new Date() })
      .execute();
    expect(await kyselyFeedReader(trx).read(userId, "8-15", 50)).toEqual({
      computed: true,
      cards: [],
    });
  });
});

test("the starter feed is read per topic, level and chip", async () => {
  await inRollback(async (trx, { userId, itemId, momentIds }) => {
    const [first, second] = momentIds;
    if (first === undefined || second === undefined) throw new Error("seed");
    const beginner = { topic: "databases", level: "beginner" } as const;
    // The shared database may hold real starter feeds; this transaction rolls back.
    await trx
      .deleteFrom("starter_feed_entry")
      .where("topic", "=", "databases")
      .where("level", "in", ["beginner", "advanced"])
      .execute();
    await trx
      .insertInto("starter_feed_entry")
      .values([
        {
          ...beginner,
          content_item_id: itemId,
          chip: "3-8",
          moment_id: second,
          rank: 1,
        },
        {
          ...beginner,
          content_item_id: itemId,
          chip: "3-8",
          moment_id: first,
          rank: 2,
        },
        {
          ...beginner,
          content_item_id: itemId,
          chip: "1-3",
          moment_id: first,
          rank: 1,
        },
        {
          ...beginner,
          level: "advanced",
          chip: "3-8",
          content_item_id: itemId,
          moment_id: first,
          rank: 1,
        },
      ])
      .execute();
    const cards = await kyselyFeedReader(trx).starter(
      userId,
      "databases",
      "beginner",
      "3-8",
      50,
    );
    expect(cards.map((c) => (c.kind === "moment" ? c.momentId : null))).toEqual(
      [second, first],
    );
  });
});

test("toCard drops a row with missing fields and logs only its id and column names", () => {
  const lines: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation(
    (chunk: string | Uint8Array) => {
      lines.push(String(chunk));
      return true;
    },
  );
  const card = toCard({
    rank: 1,
    kind: "moment",
    content_item_id: "8",
    moment_id: "9",
    section_title: "Secret-ish title",
    section_number: 1,
    section_count: 1,
    estimated_minutes: null,
    article_title: "Article",
    author: "Someone",
    source_name: "Source",
    note_text: null,
    note_ai: false,
  });

  expect(card).toBeNull();
  expect(
    toCard({
      rank: 1,
      kind: "article",
      content_item_id: "8",
      moment_id: null,
      section_title: null,
      section_number: null,
      section_count: null,
      estimated_minutes: null,
      article_title: "Article",
      author: null,
      source_name: "Source",
      note_text: "New this week.",
      note_ai: true,
    }),
  ).toEqual({
    kind: "article",
    itemId: "8",
    estimatedMinutes: null,
    articleTitle: "Article",
    author: null,
    sourceName: "Source",
    note: { text: "New this week.", ai: true },
  });
  expect(lines).toHaveLength(1);
  const logged = JSON.parse(lines[0] ?? "") as Record<string, unknown>;
  expect(logged).toMatchObject({
    momentId: "9",
    missing: ["estimated_minutes"],
  });
  expect(lines[0]).not.toContain("Secret-ish title");
});

// P1-W4-S07: Not interested and Hide source take effect before the recompute lands.
test("the user's not-interested items and hidden sources are left out at once", async () => {
  await inRollback(async (trx, { userId, itemId, momentIds }) => {
    const [first] = momentIds;
    if (first === undefined) throw new Error("seed");
    await trx
      .insertInto("user_feed_entry")
      .values({
        user_id: userId,
        chip: "3-8",
        content_item_id: itemId,
        moment_id: first,
        rank: 1,
        top_signal: "quality",
      })
      .execute();
    await trx
      .insertInto("user_feed_state")
      .values({ user_id: userId, computed_at: new Date() })
      .execute();
    await trx
      .deleteFrom("starter_feed_entry")
      .where("topic", "=", "databases")
      .where("level", "=", "beginner")
      .execute();
    await trx
      .insertInto("starter_feed_entry")
      .values({
        topic: "databases",
        level: "beginner",
        chip: "3-8",
        content_item_id: itemId,
        moment_id: first,
        rank: 1,
      })
      .execute();
    const reader = kyselyFeedReader(trx);
    const read = () => reader.read(userId, "3-8", 50);
    const starter = () =>
      reader.starter(userId, "databases", "beginner", "3-8", 50);
    expect((await read()).cards).toHaveLength(1);
    expect(await starter()).toHaveLength(1);

    // Another user's Not interested and hidden source never reach this user's feed.
    const otherId = (
      await trx
        .selectFrom("app_user")
        .select("id")
        .where("id", "!=", userId)
        .limit(1)
        .executeTakeFirstOrThrow()
    ).id;
    const source = await trx
      .selectFrom("content_item")
      .select("source_id")
      .where("id", "=", itemId)
      .executeTakeFirstOrThrow();
    await trx
      .insertInto("item_feedback")
      .values({
        user_id: otherId,
        content_item_id: itemId,
        kind: "not_interested",
      })
      .execute();
    await trx
      .insertInto("user_hidden_source")
      .values({ user_id: otherId, source_id: source.source_id })
      .execute();
    expect((await read()).cards).toHaveLength(1);
    expect(await starter()).toHaveLength(1);

    await trx
      .insertInto("item_feedback")
      .values({
        user_id: userId,
        content_item_id: itemId,
        kind: "not_interested",
      })
      .execute();
    // Still computed: only this card is gone.
    expect(await read()).toEqual({ computed: true, cards: [] });
    expect(await starter()).toEqual([]);

    await trx
      .deleteFrom("item_feedback")
      .where("user_id", "=", userId)
      .execute();
    const item = await trx
      .selectFrom("content_item")
      .select("source_id")
      .where("id", "=", itemId)
      .executeTakeFirstOrThrow();
    await trx
      .insertInto("user_hidden_source")
      .values({ user_id: userId, source_id: item.source_id })
      .execute();
    expect(await read()).toEqual({ computed: true, cards: [] });
    expect(await starter()).toEqual([]);
  });
});
