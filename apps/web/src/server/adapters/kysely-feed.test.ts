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
  otherItemId: string;
  momentId: string;
};

// One source, two items (the first with a moment left from before ADR-0058), and two
// users (P1-W4-S04).
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
  const otherItem = await trx
    .insertInto("content_item")
    .values({
      source_id: source.id,
      guid: "g2",
      canonical_url: "https://webfeed.example.test/other",
      title: "Another post",
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  const moment = await trx
    .insertInto("moment")
    .values({
      content_item_id: item.id,
      ordinal: 0,
      title: "Why consensus",
      estimated_minutes: 2,
      link: "https://webfeed.example.test/post",
      link_type: "page_top",
    })
    .returning("id")
    .executeTakeFirstOrThrow();
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
    otherItemId: otherItem.id,
    momentId: moment.id,
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

// ADR-0058: the worker stores one ranked list of articles under FEED_CHIP.
const entry = (userId: string, itemId: string, rank: number) =>
  ({
    user_id: userId,
    chip: "3-8",
    content_item_id: itemId,
    moment_id: null,
    rank,
    top_signal: "quality",
  }) as const;

async function computed(trx: Transaction<DB>, ...userIds: string[]) {
  await trx
    .insertInto("user_feed_state")
    .values(userIds.map((user_id) => ({ user_id, computed_at: new Date() })))
    .execute();
}

const articleCard = (itemId: string) => ({
  itemId,
  estimatedMinutes: null,
  articleTitle: "Consensus in practice",
  author: "Rae Writer",
  sourceName: "webfeed-test",
  reasons: null,
  projectNote: null,
  saved: false,
  frameable: false,
  topic: null,
  difficulty: null,
  state: "unread",
});

test("a feed never computed reads as not computed", async () => {
  await inRollback(async (trx, { userId }) => {
    expect(await kyselyFeedReader(trx).read(userId, 50)).toEqual({
      computed: false,
      cards: [],
    });
  });
});

test("read returns the user's own article cards in rank order, in one query", async () => {
  let queries = 0;
  const counting: KyselyPlugin = {
    transformQuery: ({ node }) => {
      queries += 1;
      return node;
    },
    transformResult: ({ result }) => Promise.resolve(result),
  };
  await inRollback(async (trx, { userId, otherId, itemId, otherItemId }) => {
    // Another user's entries stay out.
    await trx
      .insertInto("user_feed_entry")
      .values([
        entry(userId, otherItemId, 2),
        entry(userId, itemId, 1),
        entry(otherId, otherItemId, 1),
      ])
      .execute();
    await computed(trx, userId, otherId);
    const result = await kyselyFeedReader(trx.withPlugin(counting)).read(
      userId,
      50,
    );
    expect(queries).toBe(1);
    expect(result.computed).toBe(true);
    expect(result.cards.map((c) => c.itemId)).toEqual([itemId, otherItemId]);
    expect(result.cards[0]).toEqual(articleCard(itemId));
    expect(JSON.stringify(result)).not.toContain("SUMMARY TEXT");
  });
});

// ADR-0058: until stage C drops the chip column, only FEED_CHIP's article entries are
// the feed; another chip's and a moment entry stored before the switch are not read.
test("only the one list's article entries are read", async () => {
  await inRollback(async (trx, { userId, itemId, otherItemId, momentId }) => {
    await trx
      .insertInto("user_feed_entry")
      .values([
        { ...entry(userId, itemId, 1), chip: "8-15" },
        { ...entry(userId, itemId, 2), moment_id: momentId },
        entry(userId, otherItemId, 3),
      ])
      .execute();
    await computed(trx, userId);
    const { cards } = await kyselyFeedReader(trx).read(userId, 50);
    expect(cards.map((c) => c.itemId)).toEqual([otherItemId]);
    await trx.deleteFrom("starter_feed_entry").execute();
    const starter = { topic: "databases", level: "beginner" } as const;
    await trx
      .insertInto("starter_feed_entry")
      .values([
        { ...starter, content_item_id: itemId, chip: "1-3", rank: 1 },
        {
          ...starter,
          content_item_id: itemId,
          chip: "3-8",
          moment_id: momentId,
          rank: 2,
        },
        { ...starter, content_item_id: otherItemId, chip: "3-8", rank: 3 },
      ])
      .execute();
    expect(
      (
        await kyselyFeedReader(trx).starter(userId, "databases", "beginner", 50)
      ).map((c) => c.itemId),
    ).toEqual([otherItemId]);
  });
});

// ADR-0058: an article opened and not completed is Continue reading.
test("a card opened by the user reads as continue_reading", async () => {
  await inRollback(async (trx, { userId, otherId, itemId }) => {
    await trx
      .insertInto("user_feed_entry")
      .values(entry(userId, itemId, 1))
      .execute();
    await computed(trx, userId);
    const state = async () =>
      (await kyselyFeedReader(trx).read(userId, 50)).cards[0]?.state;
    expect(await state()).toBe("unread");
    await trx
      .insertInto("user_article_opened")
      .values({ user_id: otherId, content_item_id: itemId })
      .execute();
    expect(await state()).toBe("unread");
    await trx
      .insertInto("user_article_opened")
      .values({ user_id: userId, content_item_id: itemId })
      .execute();
    expect(await state()).toBe("continue_reading");
  });
});

test("a computed but empty feed reads as computed with no cards", async () => {
  await inRollback(async (trx, { userId }) => {
    await computed(trx, userId);
    expect(await kyselyFeedReader(trx).read(userId, 50)).toEqual({
      computed: true,
      cards: [],
    });
  });
});

test("the starter feed is read per topic and level", async () => {
  await inRollback(async (trx, { userId, itemId, otherItemId }) => {
    const beginner = {
      topic: "databases",
      level: "beginner",
      chip: "3-8",
    } as const;
    // The shared database may hold real starter feeds; this transaction rolls back.
    await trx
      .deleteFrom("starter_feed_entry")
      .where("topic", "=", "databases")
      .where("level", "in", ["beginner", "advanced"])
      .execute();
    await trx
      .insertInto("starter_feed_entry")
      .values([
        { ...beginner, content_item_id: otherItemId, rank: 1 },
        { ...beginner, content_item_id: itemId, rank: 2 },
        { ...beginner, level: "advanced", content_item_id: itemId, rank: 1 },
      ])
      .execute();
    const cards = await kyselyFeedReader(trx).starter(
      userId,
      "databases",
      "beginner",
      50,
    );
    expect(cards.map((c) => c.itemId)).toEqual([otherItemId, itemId]);
  });
});

// ADR-0049: a topic has reading once its starter feed has cards from sources tagged with
// it whose rights allow reading (ING-2). Concept tags on other sources' items don't count.
// ADR-0058: the per-source moments switch no longer matters; only the rights do.
test("a topic has reading only from its own tagged, readable sources", async () => {
  await inRollback(async (trx, { itemId }) => {
    await trx.deleteFrom("starter_feed_entry").execute();
    const reader = kyselyFeedReader(trx);
    expect(await reader.topicsWithReading()).toEqual([]);
    await trx
      .insertInto("starter_feed_entry")
      .values({
        topic: "software-design",
        level: "beginner",
        content_item_id: itemId,
        chip: "3-8",
        rank: 1,
      })
      .execute();
    const source = async (fields: {
      topics: string[];
      rights_profile?: "metadata_only" | "full_text_internal";
      moments_seeded?: boolean;
      moments_switched_off?: boolean;
    }) => {
      await trx
        .updateTable("source")
        .set({
          ...fields,
          moments_enabled:
            (fields.moments_seeded ?? true) &&
            !(fields.moments_switched_off ?? false),
        })
        .where("name", "=", "webfeed-test")
        .execute();
    };
    // A backend source whose article the tagger linked to a software-design concept.
    await source({ topics: ["backend"] });
    expect(await reader.topicsWithReading()).toEqual([]);
    await source({ topics: ["backend", "software-design"] });
    expect(await reader.topicsWithReading()).toEqual(["software-design"]);
    await source({ topics: ["software-design"], moments_switched_off: true });
    expect(await reader.topicsWithReading()).toEqual(["software-design"]);
    await source({
      topics: ["software-design"],
      rights_profile: "metadata_only",
      moments_seeded: false,
    });
    expect(await reader.topicsWithReading()).toEqual([]);
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
  const row = {
    content_item_id: "8",
    estimated_minutes: null,
    article_title: "Article",
    author: null,
    source_name: "Source",
    reasons: "New this week from Source.",
    reason_kinds: ["freshness", "not_a_kind"],
    saved: false,
    opened: false,
    frameable: false,
    source_topic: null,
    difficulty: null,
  };
  expect(toCard({ ...row, source_name: null })).toBeNull();
  expect(toCard(row)).toEqual({
    itemId: "8",
    estimatedMinutes: null,
    articleTitle: "Article",
    author: null,
    sourceName: "Source",
    // A kind the web doesn't know is dropped, never shown as a report choice.
    reasons: {
      text: "New this week from Source.",
      kinds: ["freshness"],
    },
    projectNote: null,
    saved: false,
    frameable: false,
    topic: null,
    difficulty: null,
    state: "unread",
  });
  expect(lines).toHaveLength(1);
  const logged = JSON.parse(lines[0] ?? "") as Record<string, unknown>;
  expect(logged).toMatchObject({ itemId: "8", missing: ["source_name"] });
  expect(lines[0]).not.toContain("Article");
});
// P1-W4-S07: Not interested and Hide source take effect before the recompute lands.
test("the user's not-interested items and hidden sources are left out at once", async () => {
  await inRollback(async (trx, { userId, otherId, itemId }) => {
    await trx
      .insertInto("user_feed_entry")
      .values({
        user_id: userId,
        chip: "3-8",
        content_item_id: itemId,
        moment_id: null,
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
        moment_id: null,
        rank: 1,
      })
      .execute();
    const reader = kyselyFeedReader(trx);
    const read = () => reader.read(userId, 50);
    const starter = () => reader.starter(userId, "databases", "beginner", 50);
    expect((await read()).cards).toHaveLength(1);
    expect(await starter()).toHaveLength(1);

    // Another user's Not interested and hidden source never reach this user's feed.
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

// A completed article leaves the feed at once, not at the next recompute (owner report,
// 2026-10-26: a card marked done kept showing).
test("completed articles are left out at once", async () => {
  await inRollback(async (trx, { userId, otherId, itemId, otherItemId }) => {
    await trx
      .insertInto("user_feed_entry")
      .values([entry(userId, itemId, 1), entry(userId, otherItemId, 2)])
      .execute();
    await computed(trx, userId);
    const ids = async () =>
      (await kyselyFeedReader(trx).read(userId, 50)).cards.map((c) => c.itemId);
    expect(await ids()).toEqual([itemId, otherItemId]);
    // Someone else's completion changes nothing here.
    await trx
      .insertInto("user_article_finished")
      .values({
        user_id: otherId,
        content_item_id: itemId,
        method: "mark_done",
      })
      .execute();
    expect(await ids()).toEqual([itemId, otherItemId]);
    await trx
      .insertInto("user_article_finished")
      .values({ user_id: userId, content_item_id: itemId, method: "mark_done" })
      .execute();
    expect(await ids()).toEqual([otherItemId]);
  });
});

// ADR-0018: a card says whether the in-app reader may frame its page; unknown is no.
test("cards say whether their page can be framed, unknown reading as no", async () => {
  await inRollback(async (trx, { userId, itemId }) => {
    await trx
      .insertInto("user_feed_entry")
      .values({
        user_id: userId,
        chip: "3-8",
        content_item_id: itemId,
        moment_id: null,
        rank: 1,
        top_signal: "quality",
      })
      .execute();
    await trx
      .insertInto("user_feed_state")
      .values({ user_id: userId, computed_at: new Date() })
      .execute();
    const framed = async () =>
      (await kyselyFeedReader(trx).read(userId, 50)).cards[0]?.frameable;
    expect(await framed()).toBe(false);
    await trx
      .updateTable("content_item")
      .set({ frameable: true })
      .where("id", "=", itemId)
      .execute();
    expect(await framed()).toBe(true);
  });
});

// ADR-0019: a card's picture comes from its source's first topic Interval knows; ADR-0027:
// it carries the difficulty the ranking stored for its label.
test("cards carry their source's first known topic, or none, and their difficulty", async () => {
  await inRollback(async (trx, { userId, itemId }) => {
    await trx
      .insertInto("user_feed_entry")
      .values({
        user_id: userId,
        chip: "3-8",
        content_item_id: itemId,
        moment_id: null,
        rank: 1,
        top_signal: "quality",
        difficulty: "intermediate",
      })
      .execute();
    await trx
      .insertInto("user_feed_state")
      .values({ user_id: userId, computed_at: new Date() })
      .execute();
    const [card] = (await kyselyFeedReader(trx).read(userId, 50)).cards;
    expect(card?.difficulty).toBe("intermediate");
    const topic = async (topics: string[]) => {
      await trx
        .updateTable("source")
        .set({ topics })
        .where("name", "=", "webfeed-test")
        .execute();
      return (await kyselyFeedReader(trx).read(userId, 50)).cards[0]?.topic;
    };
    expect(await topic([])).toBeNull();
    expect(await topic(["frontend", "databases", "backend"])).toBe("databases");
  });
});

// P1-W5-S04: a card knows whether the user saved its article.
test("cards say whether the user saved their article", async () => {
  await inRollback(async (trx, { userId, itemId }) => {
    await trx
      .insertInto("user_feed_entry")
      .values({
        user_id: userId,
        chip: "3-8",
        content_item_id: itemId,
        moment_id: null,
        rank: 1,
        top_signal: "quality",
      })
      .execute();
    await trx
      .insertInto("user_feed_state")
      .values({ user_id: userId, computed_at: new Date() })
      .execute();
    const reader = kyselyFeedReader(trx);
    expect((await reader.read(userId, 50)).cards[0]?.saved).toBe(false);
    await trx
      .insertInto("user_save")
      .values({ user_id: userId, content_item_id: itemId })
      .execute();
    expect((await reader.read(userId, 50)).cards[0]?.saved).toBe(true);
  });
});

// P2-W12-S05 (§5B, AI-3): a user's line about their own project shows only in their
// own feed, never in another user's with the same item, nor in a starter feed.
test("a project note shows only in its own user's feed", async () => {
  await inRollback(async (trx, { userId, otherId, itemId }) => {
    for (const user of [userId, otherId]) {
      await trx
        .insertInto("user_feed_entry")
        .values({
          user_id: user,
          chip: "3-8",
          content_item_id: itemId,
          moment_id: null,
          rank: 1,
          top_signal: "project_match",
        })
        .execute();
      await trx
        .insertInto("user_feed_state")
        .values({ user_id: user, computed_at: new Date() })
        .execute();
    }
    await trx
      .insertInto("github_account")
      .values({ user_id: userId, github_user_id: "77", login: "octo" })
      .execute();
    await trx
      .insertInto("github_repository")
      .values({
        user_id: userId,
        repo_id: "1",
        installation_id: "11",
        full_name: "octo/velox",
        default_branch: "main",
      })
      .execute();
    await trx
      .insertInto("project_note")
      .values({
        user_id: userId,
        content_item_id: itemId,
        repositories: ["octo/velox"],
        technologies: ["etcd"],
        text: "Velox elects its leader the same way.",
        model: "m",
      })
      .execute();
    const reader = kyselyFeedReader(trx);
    const [mine] = (await reader.read(userId, 50)).cards;
    expect(mine?.projectNote).toEqual({
      text: "Velox elects its leader the same way.",
      repositories: ["octo/velox"],
    });
    const [theirs] = (await reader.read(otherId, 50)).cards;
    expect(theirs?.projectNote).toBeNull();
    // Once the repository is no longer shared, its line is gone at once.
    await trx
      .deleteFrom("github_repository")
      .where("user_id", "=", userId)
      .execute();
    const [unshared] = (await reader.read(userId, 50)).cards;
    expect(unshared?.projectNote).toBeNull();
    // A starter feed holding the same item carries no project note either.
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
        moment_id: null,
        rank: 1,
      })
      .execute();
    const starter = await reader.starter(userId, "databases", "beginner", 50);
    expect(starter.map((c) => c.projectNote)).toEqual([null]);
  });
});

// Owner, 2026-10-29 (Q-P2-43 update): a card with the user's own project line leads
// the feed, whatever its rank.
test("a card with the user's project line comes first", async () => {
  await inRollback(async (trx, { userId, itemId, otherItemId }) => {
    await trx
      .insertInto("user_feed_entry")
      .values([
        entry(userId, otherItemId, 1),
        { ...entry(userId, itemId, 2), top_signal: "project_match" },
      ])
      .execute();
    await computed(trx, userId);
    await trx
      .insertInto("github_account")
      .values({ user_id: userId, github_user_id: "78", login: "octo" })
      .execute();
    await trx
      .insertInto("github_repository")
      .values({
        user_id: userId,
        repo_id: "1",
        installation_id: "11",
        full_name: "octo/velox",
        default_branch: "main",
      })
      .execute();
    await trx
      .insertInto("project_note")
      .values({
        user_id: userId,
        content_item_id: itemId,
        repositories: ["octo/velox"],
        technologies: ["etcd"],
        text: "Its leader election uses the same idea.",
        model: "m",
      })
      .execute();
    const { cards } = await kyselyFeedReader(trx).read(userId, 50);
    expect(cards.map((c) => c.itemId)).toEqual([itemId, otherItemId]);
  });
});
