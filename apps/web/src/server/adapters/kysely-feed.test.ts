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

type Seeded = { userId: string; otherId: string; momentIds: string[] };

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
  return { userId, otherId, momentIds: moments.map((m) => m.id) };
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
    expect(await kyselyFeedReader(trx).read(userId, 50)).toEqual({
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
  await inRollback(async (trx, { userId, otherId, momentIds }) => {
    const [first, second] = momentIds;
    if (first === undefined || second === undefined) throw new Error("seed");
    // Only the second section is in this user's feed; the count still covers both.
    await trx
      .insertInto("user_feed_entry")
      .values([
        {
          user_id: userId,
          moment_id: second,
          rank: 1,
          top_signal: "topic_match",
        },
        { user_id: otherId, moment_id: first, rank: 1, top_signal: "quality" },
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
      50,
    );
    expect(queries).toBe(1);
    expect(result).toEqual({
      computed: true,
      cards: [
        {
          momentId: second,
          sectionTitle: "Raft in one page",
          sectionNumber: 2,
          sectionCount: 2,
          estimatedMinutes: 3,
          link: "https://webfeed.example.test/post#raft",
          articleTitle: "Consensus in practice",
          author: "Rae Writer",
          sourceName: "webfeed-test",
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain("SUMMARY TEXT");
  });
});

test("a computed but empty feed reads as computed with no cards", async () => {
  await inRollback(async (trx, { userId }) => {
    await trx
      .insertInto("user_feed_state")
      .values({ user_id: userId, computed_at: new Date() })
      .execute();
    expect(await kyselyFeedReader(trx).read(userId, 50)).toEqual({
      computed: true,
      cards: [],
    });
  });
});

test("the starter feed is read per topic and level", async () => {
  await inRollback(async (trx, { momentIds }) => {
    const [first, second] = momentIds;
    if (first === undefined || second === undefined) throw new Error("seed");
    await trx
      .insertInto("starter_feed_entry")
      .values([
        { topic: "databases", level: "beginner", moment_id: second, rank: 1 },
        { topic: "databases", level: "beginner", moment_id: first, rank: 2 },
        { topic: "databases", level: "advanced", moment_id: first, rank: 1 },
      ])
      .execute();
    const cards = await kyselyFeedReader(trx).starter(
      "databases",
      "beginner",
      50,
    );
    expect(cards.map((c) => c.momentId)).toEqual([second, first]);
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
    moment_id: "9",
    section_title: "Secret-ish title",
    section_number: 1,
    section_count: 1,
    estimated_minutes: null,
    link: "https://webfeed.example.test/p",
    article_title: "Article",
    author: "Someone",
    source_name: "Source",
  });

  expect(card).toBeNull();
  expect(lines).toHaveLength(1);
  const logged = JSON.parse(lines[0] ?? "") as Record<string, unknown>;
  expect(logged).toMatchObject({
    momentId: "9",
    missing: ["estimated_minutes"],
  });
  expect(lines[0]).not.toContain("Secret-ish title");
});
