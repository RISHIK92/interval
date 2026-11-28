import { randomUUID } from "node:crypto";
import type { DB } from "@interval/db";
import { sql, type Transaction } from "kysely";
import { afterAll, expect, test } from "vitest";
import { createDb } from "./kysely";
import { kyselyFeedback } from "./kysely-feedback";
import { kyselyProgress } from "./kysely-progress";

// Completions (§5D, C-22, P1-W5-S02; ADR-0058): the first is kept; a repeat changes
// nothing. An article is the only reading unit.
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
      });
      throw new Rollback();
    }),
  ).rejects.toBeInstanceOf(Rollback);
}

test("an article is completed once; a repeat changes nothing", async () => {
  await inRollback(async (trx, { userId, itemId }) => {
    const progress = kyselyProgress(trx);
    expect(await progress.finishArticle(userId, itemId, "return_prompt")).toBe(
      true,
    );
    expect(await progress.finishArticle(userId, itemId, "mark_done")).toBe(
      false,
    );
    const kept = await trx
      .selectFrom("user_article_finished")
      .select("method")
      .where("user_id", "=", userId)
      .execute();
    expect(kept).toEqual([{ method: "return_prompt" }]);
    expect(
      await progress.finishArticle(userId, "999999999999", "mark_done"),
    ).toBe(false);
  });
});

// P4-W20-S03: the app reader's automatic finish is stored as auto.
test("an automatic finish is kept with its method", async () => {
  await inRollback(async (trx, { userId, itemId }) => {
    expect(
      await kyselyProgress(trx).finishArticle(userId, itemId, "auto"),
    ).toBe(true);
    const kept = await trx
      .selectFrom("user_article_finished")
      .select("method")
      .where("user_id", "=", userId)
      .execute();
    expect(kept).toEqual([{ method: "auto" }]);
  });
});

test("describe names the article, or nothing for a stranger's id", async () => {
  await inRollback(async (trx, { itemId }) => {
    const progress = kyselyProgress(trx);
    expect(await progress.describe(itemId)).toEqual({
      articleTitle: "Consensus in practice",
    });
    expect(await progress.describe("999999999999")).toBeNull();
  });
});

// ADR-0058: an opened article is Continue reading until it is completed.
test("an opened article gives a continue card until it is completed", async () => {
  await inRollback(async (trx, { userId, itemId }) => {
    const progress = kyselyProgress(trx);
    const now = new Date();
    expect(await progress.continueCards(userId, now, 3)).toEqual([]);
    await progress.recordOpen(userId, itemId);
    await progress.recordOpen(userId, itemId); // a second open changes nothing
    const [card, ...rest] = await progress.continueCards(userId, now, 3);
    expect(rest).toEqual([]);
    expect(card).toEqual({
      itemId,
      articleTitle: "Consensus in practice",
      sourceName: card?.sourceName,
      estimatedMinutes: null, // no body text to count (Q-P1-39)
      frameable: false, // ADR-0018: not known yet reads as no
    });
    expect(card?.sourceName).toMatch(/^prog-/);
    await trx
      .updateTable("content_item")
      .set({ frameable: true })
      .where("id", "=", itemId)
      .execute();
    expect((await progress.continueCards(userId, now, 3))[0]?.frameable).toBe(
      true,
    );
    await progress.finishArticle(userId, itemId, "mark_done");
    expect(await progress.continueCards(userId, now, 3)).toEqual([]);
  });
});

test("the first open is kept and the last moves on; an id that names nothing records nothing", async () => {
  await inRollback(async (trx, { userId, itemId }) => {
    const progress = kyselyProgress(trx);
    await progress.recordOpen(userId, itemId);
    await trx
      .updateTable("user_article_opened")
      .set({
        opened_at: sql<Date>`now() - interval '2 days'`,
        last_opened_at: sql<Date>`now() - interval '2 days'`,
      })
      .where("user_id", "=", userId)
      .execute();
    await progress.recordOpen(userId, itemId);
    await progress.recordOpen(userId, "999999999999");
    const opened = await trx
      .selectFrom("user_article_opened")
      .select([
        "content_item_id",
        sql<boolean>`opened_at < now() - interval '1 day'`.as("old"),
        sql<boolean>`last_opened_at > now() - interval '1 hour'`.as("recent"),
      ])
      .where("user_id", "=", userId)
      .execute();
    expect(opened).toEqual([
      { content_item_id: itemId, old: true, recent: true },
    ]);
  });
});

test("no continue card after 30 days", async () => {
  await inRollback(async (trx, { userId, itemId }) => {
    const progress = kyselyProgress(trx);
    await progress.recordOpen(userId, itemId);
    const later = new Date(Date.now() + 31 * 86_400_000);
    expect(await progress.continueCards(userId, later, 3)).toEqual([]);
  });
});

// The 30 days count from the last open: an article read again comes back to Continue.
test("an article first opened 31 days ago and opened again today continues", async () => {
  await inRollback(async (trx, { userId, itemId }) => {
    const progress = kyselyProgress(trx);
    await progress.recordOpen(userId, itemId);
    await trx
      .updateTable("user_article_opened")
      .set({
        opened_at: sql<Date>`now() - interval '31 days'`,
        last_opened_at: sql<Date>`now() - interval '31 days'`,
      })
      .where("user_id", "=", userId)
      .execute();
    expect(await progress.continueCards(userId, new Date(), 3)).toEqual([]);
    await progress.recordOpen(userId, itemId);
    expect(
      (await progress.continueCards(userId, new Date(), 3)).map(
        (c) => c.itemId,
      ),
    ).toEqual([itemId]);
  });
});

// ADR-0058: an article's own link is allowed under every rights profile (ING-2 gates
// text, not links), so a metadata-only article still continues.
test("a metadata-only article still gives a continue card", async () => {
  await inRollback(async (trx, { userId, itemId, sourceId }) => {
    await trx
      .updateTable("source")
      .set({ rights_profile: "metadata_only" })
      .where("id", "=", sourceId)
      .execute();
    const progress = kyselyProgress(trx);
    await progress.recordOpen(userId, itemId);
    expect(await progress.continueCards(userId, new Date(), 3)).toHaveLength(1);
  });
});

test("no continue card for an item whose link broke (P1-W6-S03)", async () => {
  await inRollback(async (trx, { userId, itemId }) => {
    const progress = kyselyProgress(trx);
    await progress.recordOpen(userId, itemId);
    expect(await progress.continueCards(userId, new Date(), 3)).toHaveLength(1);
    await trx
      .updateTable("content_item")
      .set({ link_broken_at: new Date() })
      .where("id", "=", itemId)
      .execute();
    expect(await progress.continueCards(userId, new Date(), 3)).toEqual([]);
  });
});

test("continue cards: most recently opened first, up to the limit; a reopened one moves up", async () => {
  await inRollback(async (trx, { userId, itemId, sourceId }) => {
    const progress = kyselyProgress(trx);
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
    await progress.recordOpen(userId, itemId);
    await progress.recordOpen(userId, other.id);
    const at = (id: string, days: number) =>
      trx
        .updateTable("user_article_opened")
        .set({
          opened_at: sql<Date>`now() - make_interval(days => ${days})`,
          last_opened_at: sql<Date>`now() - make_interval(days => ${days})`,
        })
        .where("user_id", "=", userId)
        .where("content_item_id", "=", id)
        .execute();
    await at(itemId, 5);
    await at(other.id, 2);
    const now = new Date();
    expect(
      (await progress.continueCards(userId, now, 3)).map((c) => c.itemId),
    ).toEqual([other.id, itemId]);
    expect(
      (await progress.continueCards(userId, now, 1)).map((c) => c.itemId),
    ).toEqual([other.id]);
    // Opened again, the older one moves to the top.
    await progress.recordOpen(userId, itemId);
    expect(
      (await progress.continueCards(userId, new Date(), 3)).map(
        (c) => c.itemId,
      ),
    ).toEqual([itemId, other.id]);
  });
});

// Owner, 2026-10-26: dismissed until the reader reads on; ADR-0058: reading on is
// opening the article again.
test("dismissing hides a continue card; opening the article again brings it back", async () => {
  await inRollback(async (trx, { userId, itemId }) => {
    const progress = kyselyProgress(trx);
    await progress.recordOpen(userId, itemId);
    await progress.dismissContinue(userId, itemId);
    expect(await progress.continueCards(userId, new Date(), 3)).toEqual([]);
    await progress.recordOpen(userId, itemId);
    const [card] = await progress.continueCards(userId, new Date(), 3);
    expect(card?.itemId).toBe(itemId);
  });
});

// P1-W5-S03: outcomes of exploration (REC-4, P1-W4-S09), counted once per user and item.
test("an explored entry's first open counts as shown, its first finish as finished", async () => {
  await inRollback(async (trx, { userId, itemId }) => {
    const progress = kyselyProgress(trx);
    await trx
      .insertInto("user_feed_entry")
      .values({
        user_id: userId,
        rank: 1,
        content_item_id: itemId,
        top_signal: "freshness",
        explore_kind: "topic",
        explore_arm: "test-arm",
      })
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
    await progress.countExploreOpen(userId, itemId);
    await progress.countExploreOpen(userId, itemId);
    expect(await outcome()).toEqual({ shown: "1", finished: "0" });
    await progress.countExploreFinish(userId, itemId);
    await progress.countExploreFinish(userId, itemId);
    expect(await outcome()).toEqual({ shown: "1", finished: "1" });
  });
});

test("opening an entry that wasn't explored counts nothing", async () => {
  await inRollback(async (trx, { userId, itemId }) => {
    await trx
      .insertInto("user_feed_entry")
      .values({
        user_id: userId,
        rank: 1,
        content_item_id: itemId,
        top_signal: "freshness",
      })
      .execute();
    await kyselyProgress(trx).countExploreOpen(userId, itemId);
    const opens = await trx
      .selectFrom("user_explore_open")
      .select("arm")
      .where("user_id", "=", userId)
      .execute();
    expect(opens).toEqual([]);
  });
});

test("opens by another user add to the same arm's shown count", async () => {
  await inRollback(async (trx, { userId, itemId }) => {
    await trx
      .insertInto("explore_arm_outcome")
      .values({ kind: "topic", arm: "shared-arm", shown: 3, finished: 1 })
      .execute();
    await trx
      .insertInto("user_feed_entry")
      .values({
        user_id: userId,
        rank: 1,
        content_item_id: itemId,
        top_signal: "freshness",
        explore_kind: "topic",
        explore_arm: "shared-arm",
      })
      .execute();
    await kyselyProgress(trx).countExploreOpen(userId, itemId);
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
        slug: `mastery-${name.toLowerCase()}-${randomUUID().slice(0, 8)}`,
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

test("an article completion raises its concepts weakly, once, to explored", async () => {
  await inRollback(async (trx, { userId, itemId }) => {
    const progress = kyselyProgress(trx);
    const [consensus] = await concepts(trx, ["consensus"]);
    await tagArticle(trx, itemId, consensus);
    await progress.finishArticle(userId, itemId, "mark_done");
    await progress.finishArticle(userId, itemId, "mark_done");
    expect(await mastery(trx, userId)).toEqual([
      { name: "consensus", p: 0.1, state: "explored", evidence: 1 },
    ]);
  });
});

test("reading never lifts a concept past the cap, nor lowers or demotes one above it", async () => {
  await inRollback(async (trx, { userId, itemId }) => {
    const [consensus, quorum] = await concepts(trx, ["consensus", "quorum"]);
    await tagArticle(trx, itemId, consensus);
    await trx
      .insertInto("item_concept")
      .values({ content_item_id: itemId, concept_id: quorum })
      .execute();
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
    await kyselyProgress(trx).finishArticle(userId, itemId, "mark_done");
    expect(await mastery(trx, userId)).toEqual([
      { name: "consensus", p: 0.3, state: "explored", evidence: 4 },
      { name: "quorum", p: 0.6, state: "practiced", evidence: 2 },
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

test("retired concepts credit nothing; an admin's whole-article correction, even empty, replaces the model's tags", async () => {
  await inRollback(async (trx, { userId, itemId }) => {
    const progress = kyselyProgress(trx);
    const [live, old] = await concepts(trx, ["live", "old"]);
    await trx
      .updateTable("concept")
      .set({ retired_at: sql<Date>`now()` })
      .where("id", "=", old)
      .execute();
    await tagArticle(trx, itemId, live);
    await trx
      .insertInto("item_concept")
      .values({ content_item_id: itemId, concept_id: old })
      .execute();
    await progress.finishArticle(userId, itemId, "mark_done");
    expect(await mastery(trx, userId)).toEqual([
      { name: "live", p: 0.1, state: "explored", evidence: 1 },
    ]);
    // A second user, after the admin's empty correction: nothing credited.
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
    await trx
      .insertInto("tag_override")
      .values({
        content_item_id: itemId,
        difficulty: "beginner",
        concepts: [],
        updated_by: "admin",
      })
      .execute();
    await progress.finishArticle(other, itemId, "mark_done");
    expect(await mastery(trx, other)).toEqual([]);
  });
});

// Q-P2-04, P2-W7-S02: Profile lists the concepts a user has explored, by topic, the
// most recently read topic and concept first.
test("explored concepts come grouped by topic, newest first, and only the user's own", async () => {
  await inRollback(async (trx, { userId }) => {
    const [raft, paxos, quorum, retired] = await concepts(trx, [
      "Raft",
      "Paxos",
      "Quorum",
      "Retired",
    ]);
    const indexes = await trx
      .insertInto("concept")
      .values({
        slug: `mastery-indexes-${randomUUID().slice(0, 8)}`,
        name: "Indexes",
        topic: "databases",
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    await trx
      .updateTable("concept")
      .set({ retired_at: sql<Date>`now()` })
      .where("id", "=", retired)
      .execute();
    const row = (conceptId: string, at: string) => ({
      user_id: userId,
      concept_id: conceptId,
      probability: 0.1,
      state: "explored" as const,
      evidence_count: 1,
      updated_at: new Date(at),
    });
    // Databases holds the newest row, so it comes first; Paxos and Quorum, credited
    // by one finish, tie and come by name.
    await trx
      .insertInto("concept_mastery")
      .values([
        row(raft, "2026-10-01T00:00:00Z"),
        { ...row(quorum, "2026-10-02T00:00:00Z"), state: "practiced" as const },
        row(paxos, "2026-10-02T00:00:00Z"),
        row(indexes.id, "2026-10-03T00:00:00Z"),
        row(retired, "2026-10-04T00:00:00Z"),
      ])
      .execute();
    const got = await kyselyProgress(trx).concepts(userId);
    expect(
      got.map((g) => ({
        topic: g.topic,
        names: g.concepts.map((c) => c.name),
      })),
    ).toEqual([
      { topic: "databases", names: ["Indexes"] },
      { topic: "distributed-systems", names: ["Paxos", "Quorum", "Raft"] },
    ]);
    expect(
      got
        .flatMap((g) => g.concepts)
        .every((c) => c.slug.startsWith("mastery-")),
    ).toBe(true);
    // P2-W9-S03: each with its state, as Profile shows it.
    expect(
      got.flatMap((g) => g.concepts).map((c) => [c.name, c.state]),
    ).toEqual([
      ["Indexes", "explored"],
      ["Paxos", "explored"],
      ["Quorum", "practiced"],
      ["Raft", "explored"],
    ]);
    // P2-W9-S04: due for review once its FSRS card's due date has passed.
    const card = (conceptId: string, due: string) => ({
      user_id: userId,
      concept_id: conceptId,
      due: new Date(due),
      stability: 3,
      difficulty: 5,
      scheduled_days: 3,
      learning_steps: 0,
      reps: 1,
      lapses: 0,
      state: 2,
      last_review: new Date("2026-10-01T00:00:00Z"),
    });
    await trx
      .insertInto("concept_review")
      .values([
        card(quorum, "2026-10-04T00:00:00Z"),
        card(raft, "2099-01-01T00:00:00Z"),
      ])
      .execute();
    const due = await kyselyProgress(trx).concepts(userId);
    expect(due.flatMap((g) => g.concepts).map((c) => [c.name, c.due])).toEqual([
      ["Indexes", false],
      ["Paxos", false],
      ["Quorum", true],
      ["Raft", false],
    ]);
    expect(await kyselyProgress(trx).concepts("someone-else")).toEqual([]);
  });
});
