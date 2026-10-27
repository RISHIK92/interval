import { randomUUID } from "node:crypto";
import type { DB } from "@interval/db";
import { sql, type Transaction } from "kysely";
import { afterAll, expect, test } from "vitest";
import { createDb } from "./kysely";
import { kyselyFeedback } from "./kysely-feedback";
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
      frameable: false,
    });
    expect(await progress.nextMoment(itemId, paxos)).toBeNull();
    // The reader opens it when the page can be framed (ADR-0018).
    await trx
      .updateTable("content_item")
      .set({ frameable: true })
      .where("id", "=", itemId)
      .execute();
    expect((await progress.nextMoment(itemId, intro))?.frameable).toBe(true);
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
        frameable: false, // ADR-0018: not known yet reads as no
      },
    ]);
    await trx
      .updateTable("content_item")
      .set({ frameable: true })
      .where("id", "=", itemId)
      .execute();
    expect((await progress.continueCards(userId, now, 3))[0]?.frameable).toBe(
      true,
    );
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

// Concept mastery from reading (PER-2, Q-P2-02, Q-P2-03, P2-W7-S01): a new finish
// raises its tagged concepts weakly, to explored at most; nothing else does.
// The new concepts' ids, in the order named; a missing one fails here, not later as a
// bad bigint.
async function concepts<const N extends readonly string[]>(
  trx: Transaction<DB>,
  names: N,
): Promise<{ [K in keyof N]: string }> {
  const rows = await trx
    .insertInto("concept")
    .values(
      names.map((name) => ({
        slug: `mastery-${name}-${randomUUID().slice(0, 8)}`,
        name,
        topic: "distributed-systems",
      })),
    )
    .returning(["id", "name"])
    .execute();
  const ids = names.map((name) => {
    const row = rows.find((r) => r.name === name);
    if (row === undefined) throw new Error(`seed ${name}`);
    return row.id;
  });
  // map keeps the tuple's length and order; TypeScript only widens it to string[].
  return ids as { [K in keyof N]: string };
}

async function mastery(trx: Transaction<DB>, userId: string) {
  const rows = await trx
    .selectFrom("concept_mastery as m")
    .innerJoin("concept as c", "c.id", "m.concept_id")
    .select(["c.name", "m.probability", "m.state", "m.evidence_count"])
    .where("m.user_id", "=", userId)
    .orderBy("c.name")
    .execute();
  return rows.map((r) => ({
    name: r.name,
    p: Math.round(r.probability * 1000) / 1000,
    state: r.state,
    evidence: r.evidence_count,
  }));
}

async function tag(
  trx: Transaction<DB>,
  momentId: string,
  conceptIds: string[],
) {
  await trx
    .insertInto("moment_tagging")
    .values({ moment_id: momentId, difficulty: "intermediate" })
    .execute();
  await trx
    .insertInto("moment_concept")
    .values(conceptIds.map((id) => ({ moment_id: momentId, concept_id: id })))
    .execute();
}

async function tagArticle(
  trx: Transaction<DB>,
  itemId: string,
  conceptId: string,
) {
  await trx
    .insertInto("item_tagging")
    .values({
      content_item_id: itemId,
      difficulty: "intermediate",
      model: "test",
      prompt_version: 1,
    })
    .execute();
  await trx
    .insertInto("item_concept")
    .values({ content_item_id: itemId, concept_id: conceptId })
    .execute();
}

test("a new moment finish raises its concepts weakly, once, to explored", async () => {
  await inRollback(async (trx, { userId, itemId, momentIds }) => {
    const progress = kyselyProgress(trx);
    const [, raft, paxos] = momentIds;
    if (raft === undefined || paxos === undefined) throw new Error("seed");
    const [consensus, r, p] = await concepts(trx, [
      "consensus",
      "raft",
      "paxos",
    ]);
    await tag(trx, raft, [consensus, r]);
    await tag(trx, paxos, [consensus, p]);
    await progress.finishMoment(userId, itemId, raft, "mark_done");
    await progress.finishMoment(userId, itemId, raft, "return_prompt");
    expect(await mastery(trx, userId)).toEqual([
      { name: "consensus", p: 0.1, state: "explored", evidence: 1 },
      { name: "raft", p: 0.1, state: "explored", evidence: 1 },
    ]);
    await progress.finishMoment(userId, itemId, paxos, "mark_done");
    expect(await mastery(trx, userId)).toEqual([
      { name: "consensus", p: 0.19, state: "explored", evidence: 2 },
      { name: "paxos", p: 0.1, state: "explored", evidence: 1 },
      { name: "raft", p: 0.1, state: "explored", evidence: 1 },
    ]);
  });
});

test("reading never lifts a concept past the cap, nor lowers or demotes one above it", async () => {
  await inRollback(async (trx, { userId, itemId, momentIds }) => {
    const progress = kyselyProgress(trx);
    const [intro, raft] = momentIds;
    if (intro === undefined || raft === undefined) throw new Error("seed");
    const [consensus, quorum] = await concepts(trx, ["consensus", "quorum"]);
    await tag(trx, intro, [consensus, quorum]);
    await tag(trx, raft, [consensus, quorum]);
    // Near the cap from earlier reading, and above it as a Week 9 quiz would leave it.
    await trx
      .insertInto("concept_mastery")
      .values([
        {
          user_id: userId,
          concept_id: consensus,
          probability: 0.29,
          state: "explored",
          evidence_count: 3,
        },
        {
          user_id: userId,
          concept_id: quorum,
          probability: 0.6,
          state: "practiced",
          evidence_count: 1,
        },
      ])
      .execute();
    await progress.finishMoment(userId, itemId, intro, "mark_done");
    await progress.finishMoment(userId, itemId, raft, "mark_done");
    expect(await mastery(trx, userId)).toEqual([
      { name: "consensus", p: 0.3, state: "explored", evidence: 5 },
      { name: "quorum", p: 0.6, state: "practiced", evidence: 3 },
    ]);
  });
});

test("an untagged moment credits nothing; an admin's correction replaces the model's tags", async () => {
  await inRollback(async (trx, { userId, itemId, momentIds }) => {
    const progress = kyselyProgress(trx);
    const [intro, raft] = momentIds;
    if (intro === undefined || raft === undefined) throw new Error("seed");
    const [r] = await concepts(trx, ["raft"]);
    const leader = await trx
      .insertInto("concept")
      .values({
        slug: `mastery-leader-${randomUUID().slice(0, 8)}`,
        name: "leader-election",
        topic: "distributed-systems",
      })
      .returning("slug")
      .executeTakeFirstOrThrow();
    await progress.finishMoment(userId, itemId, intro, "mark_done");
    expect(await mastery(trx, userId)).toEqual([]);
    await tag(trx, raft, [r]);
    await trx
      .insertInto("tag_override")
      .values({
        content_item_id: itemId,
        heading: "Raft",
        difficulty: "intermediate",
        concepts: [leader.slug],
        updated_by: "admin",
      })
      .execute();
    await progress.finishMoment(userId, itemId, raft, "mark_done");
    expect(await mastery(trx, userId)).toEqual([
      { name: "leader-election", p: 0.1, state: "explored", evidence: 1 },
    ]);
  });
});

test("an article finish credits the article's concepts, also when its last section completes it", async () => {
  await inRollback(async (trx, { userId, itemId, momentIds }) => {
    const progress = kyselyProgress(trx);
    const [consensus] = await concepts(trx, ["consensus"]);
    await tagArticle(trx, itemId, consensus);
    await progress.finishArticle(userId, itemId, "mark_done");
    await progress.finishArticle(userId, itemId, "mark_done");
    expect(await mastery(trx, userId)).toEqual([
      { name: "consensus", p: 0.1, state: "explored", evidence: 1 },
    ]);
    // A second user completes the article section by section (Q-P1-35).
    const invite = await trx
      .selectFrom("app_user")
      .select("invite_code_id")
      .where("id", "=", userId)
      .executeTakeFirstOrThrow();
    const other = randomUUID();
    await trx
      .insertInto("app_user")
      .values({
        id: other,
        name: "n",
        email: `${other}@example.test`,
        beta_group: "student",
        invite_code_id: invite.invite_code_id,
      })
      .execute();
    for (const m of momentIds) {
      await progress.finishMoment(other, itemId, m, "mark_done");
    }
    expect(
      await progress.finishArticleIfComplete(other, itemId, "mark_done"),
    ).toBe(true);
    expect(await mastery(trx, other)).toEqual([
      { name: "consensus", p: 0.1, state: "explored", evidence: 1 },
    ]);
  });
});

test("resetting inferred interests leaves mastery alone (PER-1)", async () => {
  await inRollback(async (trx, { userId, itemId }) => {
    const [consensus] = await concepts(trx, ["consensus"]);
    await tagArticle(trx, itemId, consensus);
    await kyselyProgress(trx).finishArticle(userId, itemId, "mark_done");
    await kyselyFeedback(trx).resetInferred(userId);
    expect(await mastery(trx, userId)).toHaveLength(1);
  });
});

test("retired concepts, disallowed moments and a stranger's ids credit nothing", async () => {
  await inRollback(async (trx, { userId, itemId, sourceId, momentIds }) => {
    const progress = kyselyProgress(trx);
    const [intro, raft, paxos] = momentIds;
    if (intro === undefined || raft === undefined || paxos === undefined) {
      throw new Error("seed");
    }
    const [live, old] = await concepts(trx, ["live", "old"]);
    await trx
      .updateTable("concept")
      .set({ retired_at: sql<Date>`now()` })
      .where("id", "=", old)
      .execute();
    await tag(trx, intro, [live, old]);
    await tag(trx, raft, [live]);
    await tag(trx, paxos, [live]);
    await progress.finishMoment(userId, itemId, intro, "mark_done");
    // Another item's id with this moment: not this item's moment, so not finished.
    await progress.finishMoment(userId, "999999999999", raft, "mark_done");
    expect(await mastery(trx, userId)).toEqual([
      { name: "live", p: 0.1, state: "explored", evidence: 1 },
    ]);
    // The source switches moments off (ING-2): finishing one is kept, not read.
    await trx
      .updateTable("source")
      .set({ moments_switched_off: true, moments_enabled: false })
      .where("id", "=", sourceId)
      .execute();
    await progress.finishMoment(userId, itemId, raft, "mark_done");
    expect(await mastery(trx, userId)).toEqual([
      { name: "live", p: 0.1, state: "explored", evidence: 1 },
    ]);
  });
});

test("corrections: the intro can't be overridden by heading; an article's, even empty, replaces its tags", async () => {
  await inRollback(async (trx, { userId, itemId, momentIds }) => {
    const progress = kyselyProgress(trx);
    const [intro] = momentIds;
    if (intro === undefined) throw new Error("seed");
    const [model, corrected] = await concepts(trx, ["model", "corrected"]);
    const slug = await trx
      .selectFrom("concept")
      .select("slug")
      .where("id", "=", corrected)
      .executeTakeFirstOrThrow();
    await tag(trx, intro, [model]);
    await tagArticle(trx, itemId, model);
    await trx
      .insertInto("tag_override")
      .values([
        // The intro is its page's top, not a heading: this matches no moment.
        {
          content_item_id: itemId,
          heading: "Intro",
          difficulty: "beginner",
          concepts: [slug.slug],
          updated_by: "admin",
        },
        {
          content_item_id: itemId,
          heading: "",
          difficulty: "beginner",
          concepts: [],
          updated_by: "admin",
        },
      ])
      .execute();
    await trx
      .updateTable("moment")
      .set({ link_type: "page_top" })
      .where("id", "=", intro)
      .execute();
    await progress.finishMoment(userId, itemId, intro, "mark_done");
    await progress.finishArticle(userId, itemId, "mark_done");
    // The intro keeps the model's tag; the article's empty correction credits nothing.
    expect(await mastery(trx, userId)).toEqual([
      { name: "model", p: 0.1, state: "explored", evidence: 1 },
    ]);
  });
});
