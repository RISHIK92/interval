import { randomUUID } from "node:crypto";
import type { DB } from "@interval/db";
import { sql, type Transaction } from "kysely";
import { afterAll, expect, test } from "vitest";
import { createDb } from "./kysely";
import { kyselyProgress } from "./kysely-progress";

// Finishes (§5D, C-22, P1-W5-S02): the first is kept; a repeat changes nothing.
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
  userId: string;
  itemId: string;
  sourceId: string;
  momentIds: string[];
};

async function inRollback(
  body: (trx: Transaction<DB>, seeded: Seeded) => Promise<void>,
): Promise<void> {
  await expect(
    db.transaction().execute(async (trx) => {
      const source = await trx
        .insertInto("source")
        .values({
          name: `prog-${randomUUID()}`,
          feed_url: "https://prog.example.test/feed.xml",
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
          guid: "prog-1",
          canonical_url: "https://prog.example.test/post",
          title: "Consensus in practice",
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      const moments = await trx
        .insertInto("moment")
        .values(
          ["Intro", "Raft", "Paxos"].map((title, ordinal) => ({
            content_item_id: item.id,
            ordinal,
            title,
            estimated_minutes: 3,
            link: `https://prog.example.test/post#${title.toLowerCase()}`,
            link_type: "anchor" as const,
          })),
        )
        .returning("id")
        .execute();
      const code = await trx
        .insertInto("invite_code")
        .values({
          code: `PROG${randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`,
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
      await body(trx, {
        userId,
        itemId: item.id,
        sourceId: source.id,
        momentIds: moments.map((m) => m.id),
      });
      throw new Rollback();
    }),
  ).rejects.toBeInstanceOf(Rollback);
}

test("a section or an article is finished once; a repeat changes nothing", async () => {
  await inRollback(async (trx, { userId, itemId, momentIds }) => {
    const progress = kyselyProgress(trx);
    const [first] = momentIds;
    if (first === undefined) throw new Error("seed");
    expect(
      await progress.finishMoment(userId, itemId, first, "return_prompt"),
    ).toBe(true);
    expect(
      await progress.finishMoment(userId, itemId, first, "mark_done"),
    ).toBe(false);
    expect(await progress.finishArticle(userId, itemId, "mark_done")).toBe(
      true,
    );
    expect(await progress.finishArticle(userId, itemId, "mark_done")).toBe(
      false,
    );
    const kept = await trx
      .selectFrom("user_moment_finished")
      .select("method")
      .where("user_id", "=", userId)
      .execute();
    expect(kept).toEqual([{ method: "return_prompt" }]);
    expect(
      await progress.finishMoment(userId, itemId, "999999999999", "mark_done"),
    ).toBe(false);
    expect(
      await progress.finishArticle(userId, "999999999999", "mark_done"),
    ).toBe(false);
  });
});

test("the next section follows by order; the last has none", async () => {
  await inRollback(async (trx, { itemId, momentIds }) => {
    const progress = kyselyProgress(trx);
    const [intro, raft, paxos] = momentIds;
    if (intro === undefined || raft === undefined || paxos === undefined) {
      throw new Error("seed");
    }
    expect(await progress.nextMoment(itemId, intro)).toEqual({
      momentId: raft,
      title: "Raft",
    });
    expect(await progress.nextMoment(itemId, paxos)).toBeNull();
  });
});

test("describe names the section and article, or nothing for a stranger's ids", async () => {
  await inRollback(async (trx, { itemId, momentIds }) => {
    const progress = kyselyProgress(trx);
    const [intro] = momentIds;
    if (intro === undefined) throw new Error("seed");
    expect(await progress.describe(itemId, intro)).toEqual({
      articleTitle: "Consensus in practice",
      sectionTitle: "Intro",
    });
    expect(await progress.describe(itemId, null)).toEqual({
      articleTitle: "Consensus in practice",
      sectionTitle: null,
    });
    expect(await progress.describe("999999999999", null)).toBeNull();
    expect(await progress.describe("999999999999", intro)).toBeNull();
  });
});

test("a section is finished only under its own article", async () => {
  await inRollback(async (trx, { userId, momentIds }) => {
    const [first] = momentIds;
    if (first === undefined) throw new Error("seed");
    expect(
      await kyselyProgress(trx).finishMoment(
        userId,
        "999999999999",
        first,
        "mark_done",
      ),
    ).toBe(false);
  });
});

test("sections of a source that no longer allows moments are not named (ING-2)", async () => {
  await inRollback(async (trx, { itemId, sourceId, momentIds }) => {
    const [intro] = momentIds;
    if (intro === undefined) throw new Error("seed");
    // Profile change without the purge trigger: a stale moment row is left behind.
    await sql`set local session_replication_role = replica`.execute(trx);
    await trx
      .updateTable("source")
      .set({ rights_profile: "metadata_only" })
      .where("id", "=", sourceId)
      .execute();
    await sql`set local session_replication_role = origin`.execute(trx);
    const progress = kyselyProgress(trx);
    expect(await progress.describe(itemId, intro)).toBeNull();
    expect(await progress.nextMoment(itemId, intro)).toBeNull();
    expect(await progress.describe(itemId, null)).toEqual({
      articleTitle: "Consensus in practice",
      sectionTitle: null,
    });
  });
});

// P1-W5-S03: progress, article completion and continue cards (Q-P1-35, Q-P1-40).
test("an article is finished when its last section is, once", async () => {
  await inRollback(async (trx, { userId, itemId, momentIds }) => {
    const progress = kyselyProgress(trx);
    const [intro, raft, paxos] = momentIds;
    if (intro === undefined || raft === undefined || paxos === undefined) {
      throw new Error("seed");
    }
    await progress.finishMoment(userId, itemId, intro, "mark_done");
    await progress.finishMoment(userId, itemId, raft, "mark_done");
    expect(
      await progress.finishArticleIfComplete(userId, itemId, "mark_done"),
    ).toBe(false);
    await progress.finishMoment(userId, itemId, paxos, "return_prompt");
    expect(
      await progress.finishArticleIfComplete(userId, itemId, "return_prompt"),
    ).toBe(true);
    expect(
      await progress.finishArticleIfComplete(userId, itemId, "return_prompt"),
    ).toBe(false);
  });
});

test("a half-read article gives a continue card at its next unfinished section", async () => {
  await inRollback(async (trx, { userId, itemId, momentIds }) => {
    const progress = kyselyProgress(trx);
    const [intro, raft] = momentIds;
    if (intro === undefined || raft === undefined) throw new Error("seed");
    const now = new Date();
    expect(await progress.continueCards(userId, now, 3)).toEqual([]);
    await progress.finishMoment(userId, itemId, intro, "mark_done");
    expect(await progress.continueCards(userId, now, 3)).toEqual([
      {
        itemId,
        momentId: raft,
        sectionTitle: "Raft",
        sectionNumber: 2,
        sectionCount: 3,
        articleTitle: "Consensus in practice",
      },
    ]);
    // Dismissed: gone for that article.
    await progress.dismissContinue(userId, itemId);
    expect(await progress.continueCards(userId, now, 3)).toEqual([]);
  });
});

test("no continue card once the article is finished or after 30 days", async () => {
  await inRollback(async (trx, { userId, itemId, momentIds }) => {
    const progress = kyselyProgress(trx);
    const [intro] = momentIds;
    if (intro === undefined) throw new Error("seed");
    await progress.finishMoment(userId, itemId, intro, "mark_done");
    const later = new Date(Date.now() + 31 * 86_400_000);
    expect(await progress.continueCards(userId, later, 3)).toEqual([]);
    await progress.finishArticle(userId, itemId, "mark_done");
    expect(await progress.continueCards(userId, new Date(), 3)).toEqual([]);
  });
});

test("no continue card for a source that no longer allows moments", async () => {
  await inRollback(async (trx, { userId, itemId, sourceId, momentIds }) => {
    const progress = kyselyProgress(trx);
    const [intro] = momentIds;
    if (intro === undefined) throw new Error("seed");
    await progress.finishMoment(userId, itemId, intro, "mark_done");
    await sql`set local session_replication_role = replica`.execute(trx);
    await trx
      .updateTable("source")
      .set({ moments_enabled: false, moments_switched_off: true })
      .where("id", "=", sourceId)
      .execute();
    await sql`set local session_replication_role = origin`.execute(trx);
    expect(await progress.continueCards(userId, new Date(), 3)).toEqual([]);
  });
});

test("no continue card for an item whose link broke (P1-W6-S03)", async () => {
  await inRollback(async (trx, { userId, itemId, momentIds }) => {
    const progress = kyselyProgress(trx);
    const [intro] = momentIds;
    if (intro === undefined) throw new Error("seed");
    await progress.finishMoment(userId, itemId, intro, "mark_done");
    expect(await progress.continueCards(userId, new Date(), 3)).toHaveLength(1);
    await trx
      .updateTable("content_item")
      .set({ link_broken_at: new Date() })
      .where("id", "=", itemId)
      .execute();
    expect(await progress.continueCards(userId, new Date(), 3)).toEqual([]);
  });
});

// Owner, 2026-10-26: opening a section counts as reading it for continue cards.
test("opening a section, without finishing it, offers the next one", async () => {
  await inRollback(async (trx, { userId, itemId, momentIds }) => {
    const progress = kyselyProgress(trx);
    const [intro, raft, paxos] = momentIds;
    if (intro === undefined || raft === undefined || paxos === undefined) {
      throw new Error("seed");
    }
    await progress.recordOpen(userId, itemId, intro);
    await progress.recordOpen(userId, itemId, intro); // a second open changes nothing
    const [card] = await progress.continueCards(userId, new Date(), 3);
    expect(card?.momentId).toBe(raft);
    // Opened is not finished: the article doesn't complete on opens.
    await progress.recordOpen(userId, itemId, raft);
    await progress.recordOpen(userId, itemId, paxos);
    expect(await progress.continueCards(userId, new Date(), 3)).toEqual([]);
    expect(
      await progress.finishArticleIfComplete(userId, itemId, "mark_done"),
    ).toBe(false);
    // A moment named under another article is not recorded.
    await trx
      .deleteFrom("user_moment_opened")
      .where("user_id", "=", userId)
      .execute();
    await progress.recordOpen(userId, "999999999999", intro);
    const opened = await trx
      .selectFrom("user_moment_opened")
      .select("moment_id")
      .where("user_id", "=", userId)
      .execute();
    expect(opened).toEqual([]);
  });
});

test("continue cards: most recent read first, up to the limit; a later read reorders", async () => {
  await inRollback(async (trx, { userId, itemId, sourceId, momentIds }) => {
    const progress = kyselyProgress(trx);
    const [intro] = momentIds;
    if (intro === undefined) throw new Error("seed");
    const other = await trx
      .insertInto("content_item")
      .values({
        source_id: sourceId,
        guid: "prog-2",
        canonical_url: "https://prog.example.test/other",
        title: "Other",
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    const [first] = await trx
      .insertInto("moment")
      .values(
        ["One", "Two"].map((title, ordinal) => ({
          content_item_id: other.id,
          ordinal,
          title,
          estimated_minutes: 3,
          link: `https://prog.example.test/other#${title}`,
          link_type: "anchor" as const,
        })),
      )
      .returning("id")
      .execute();
    if (first === undefined) throw new Error("seed");
    await progress.finishMoment(userId, itemId, intro, "mark_done");
    await progress.recordOpen(userId, other.id, first.id);
    const at = (days: number) =>
      sql<Date>`now() - make_interval(days => ${days})`;
    await trx
      .updateTable("user_moment_finished")
      .set({ finished_at: at(5) })
      .where("user_id", "=", userId)
      .execute();
    await trx
      .updateTable("user_moment_opened")
      .set({ opened_at: at(2) })
      .where("user_id", "=", userId)
      .execute();
    const now = new Date();
    expect(
      (await progress.continueCards(userId, now, 3)).map((c) => c.itemId),
    ).toEqual([other.id, itemId]);
    expect(
      (await progress.continueCards(userId, now, 1)).map((c) => c.itemId),
    ).toEqual([other.id]);
  });
});

// Owner, 2026-10-26: dismissed until the reader reads on.
test("a later read brings a dismissed continue card back", async () => {
  await inRollback(async (trx, { userId, itemId, momentIds }) => {
    const progress = kyselyProgress(trx);
    const [intro, raft] = momentIds;
    if (intro === undefined || raft === undefined) throw new Error("seed");
    await progress.finishMoment(userId, itemId, intro, "mark_done");
    await trx
      .updateTable("user_moment_finished")
      .set({ finished_at: sql<Date>`now() - interval '1 hour'` })
      .execute();
    await progress.dismissContinue(userId, itemId);
    expect(await progress.continueCards(userId, new Date(), 3)).toEqual([]);
    await progress.recordOpen(userId, itemId, raft);
    await trx
      .updateTable("user_moment_opened")
      .set({ opened_at: sql<Date>`now() + interval '1 minute'` })
      .execute();
    const [card] = await progress.continueCards(userId, new Date(), 3);
    expect(card?.sectionTitle).toBe("Paxos");
  });
});

// P1-W5-S03: outcomes of exploration (REC-4, P1-W4-S09), counted once per user and item.
test("an explored entry's first open counts as shown, its first finish as finished", async () => {
  await inRollback(async (trx, { userId, itemId, momentIds }) => {
    const progress = kyselyProgress(trx);
    const [intro, raft] = momentIds;
    if (intro === undefined || raft === undefined) throw new Error("seed");
    await trx
      .insertInto("user_feed_entry")
      .values([
        {
          user_id: userId,
          chip: "3-8",
          rank: 1,
          content_item_id: itemId,
          moment_id: intro,
          top_signal: "freshness",
          explore_kind: "topic",
          explore_arm: "test-arm",
        },
        {
          user_id: userId,
          chip: "3-8",
          rank: 2,
          content_item_id: itemId,
          moment_id: raft,
          top_signal: "freshness",
        },
      ])
      .execute();
    const outcome = () =>
      trx
        .selectFrom("explore_arm_outcome")
        .select(["shown", "finished"])
        .where("kind", "=", "topic")
        .where("arm", "=", "test-arm")
        .executeTakeFirst();
    // A finish before any explored open counts nothing.
    await progress.countExploreFinish(userId, itemId);
    expect(await outcome()).toBeUndefined();
    await progress.countExploreOpen(userId, "3-8", itemId, intro);
    await progress.countExploreOpen(userId, "3-8", itemId, intro);
    expect(await outcome()).toEqual({ shown: "1", finished: "0" });
    await progress.countExploreFinish(userId, itemId);
    await progress.countExploreFinish(userId, itemId);
    expect(await outcome()).toEqual({ shown: "1", finished: "1" });
  });
});

test("opening an entry that wasn't explored counts nothing", async () => {
  await inRollback(async (trx, { userId, itemId, momentIds }) => {
    const [, raft] = momentIds;
    if (raft === undefined) throw new Error("seed");
    await trx
      .insertInto("user_feed_entry")
      .values({
        user_id: userId,
        chip: "3-8",
        rank: 1,
        content_item_id: itemId,
        moment_id: raft,
        top_signal: "freshness",
      })
      .execute();
    await kyselyProgress(trx).countExploreOpen(userId, "3-8", itemId, raft);
    const opens = await trx
      .selectFrom("user_explore_open")
      .select("arm")
      .where("user_id", "=", userId)
      .execute();
    expect(opens).toEqual([]);
  });
});

test("a whole article's explored entry counts; a moment card of the same item doesn't match it", async () => {
  await inRollback(async (trx, { userId, itemId, momentIds }) => {
    const [intro] = momentIds;
    if (intro === undefined) throw new Error("seed");
    await trx
      .insertInto("user_feed_entry")
      .values({
        user_id: userId,
        chip: "8-15",
        rank: 1,
        content_item_id: itemId,
        moment_id: null,
        top_signal: "freshness",
        explore_kind: "source",
        explore_arm: "art-arm",
      })
      .execute();
    const progress = kyselyProgress(trx);
    await progress.countExploreOpen(userId, "8-15", itemId, intro);
    const none = await trx
      .selectFrom("user_explore_open")
      .select("arm")
      .where("user_id", "=", userId)
      .execute();
    expect(none).toEqual([]);
    await progress.countExploreOpen(userId, "8-15", itemId, null);
    const outcome = await trx
      .selectFrom("explore_arm_outcome")
      .select(["shown", "finished"])
      .where("kind", "=", "source")
      .where("arm", "=", "art-arm")
      .executeTakeFirst();
    expect(outcome).toEqual({ shown: "1", finished: "0" });
  });
});

test("opens by another user add to the same arm's shown count", async () => {
  await inRollback(async (trx, { userId, itemId, momentIds }) => {
    const [intro] = momentIds;
    if (intro === undefined) throw new Error("seed");
    await trx
      .insertInto("explore_arm_outcome")
      .values({ kind: "topic", arm: "shared-arm", shown: 3, finished: 1 })
      .execute();
    await trx
      .insertInto("user_feed_entry")
      .values({
        user_id: userId,
        chip: "3-8",
        rank: 1,
        content_item_id: itemId,
        moment_id: intro,
        top_signal: "freshness",
        explore_kind: "topic",
        explore_arm: "shared-arm",
      })
      .execute();
    await kyselyProgress(trx).countExploreOpen(userId, "3-8", itemId, intro);
    const outcome = await trx
      .selectFrom("explore_arm_outcome")
      .select(["shown", "finished"])
      .where("arm", "=", "shared-arm")
      .executeTakeFirst();
    expect(outcome).toEqual({ shown: "4", finished: "1" });
  });
});
