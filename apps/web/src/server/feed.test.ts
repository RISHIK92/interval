import { afterAll, afterEach, expect, test, vi } from "vitest";
import { createDb } from "./db";
import { type FeedCard, getFeed, toCard } from "./feed";

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

test("getFeed returns cards from feed_visible in rank order", async () => {
  let cards: FeedCard[] = [];
  let momentIds: string[] = [];
  await expect(
    db.transaction().execute(async (trx) => {
      const source = await trx
        .insertInto("source")
        .values({
          name: "webfeed-test",
          feed_url: "https://webfeed.example.test/feed.xml",
          rights_profile: "full_text_internal",
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
      momentIds = moments.map((m) => m.id);
      const second = moments[1];
      if (second === undefined)
        throw new Error("seed inserted fewer than two moments");
      // Only the second section is in the feed; the count still covers both.
      await trx
        .insertInto("feed_entry")
        .values({ moment_id: second.id, rank: -1000 })
        .execute();
      cards = (await getFeed(trx)).filter(
        (c) => c.sourceName === "webfeed-test",
      );
      throw new Rollback();
    }),
  ).rejects.toBeInstanceOf(Rollback);

  expect(cards).toEqual([
    {
      momentId: momentIds[1],
      sectionTitle: "Raft in one page",
      sectionNumber: 2,
      sectionCount: 2,
      estimatedMinutes: 3,
      link: "https://webfeed.example.test/post#raft",
      articleTitle: "Consensus in practice",
      author: "Rae Writer",
      sourceName: "webfeed-test",
    },
  ]);
  expect(JSON.stringify(cards)).not.toContain("SUMMARY TEXT");
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
