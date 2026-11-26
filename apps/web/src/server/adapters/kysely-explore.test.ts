import { randomUUID } from "node:crypto";
import type { DB } from "@interval/db";
import { sql, type Transaction } from "kysely";
import { afterAll, expect, test } from "vitest";
import { createDb } from "./kysely";
import { kyselyExplore } from "./kysely-explore";

// ADR-0046: Explore's search, spaces, gap card and "Saved most this week", against
// Postgres. Words are random so the shared catalogue never matches them.
const connectionString = process.env["DATABASE_URL"];
if (connectionString === undefined) {
  throw new Error("DATABASE_URL is not set; copy .env.example to .env");
}
const db = createDb(connectionString);

afterAll(async () => {
  await db.destroy();
});

class Rollback extends Error {}

async function inRollback(
  body: (trx: Transaction<DB>) => Promise<void>,
): Promise<void> {
  await expect(
    db.transaction().execute(async (trx) => {
      await body(trx);
      throw new Rollback();
    }),
  ).rejects.toBeInstanceOf(Rollback);
}

// Letters only: the text search parser keeps them as one word.
const word = () =>
  Array.from(
    { length: 10 },
    () => "abcdefghijklmnopqrstuvwxyz"[Math.floor(Math.random() * 26)],
  ).join("");

async function user(trx: Transaction<DB>): Promise<string> {
  const id = randomUUID();
  await trx
    .insertInto("app_user")
    .values({ id, name: "Ada Lovelace", email: `${id}@example.test` })
    .execute();
  return id;
}

async function source(
  trx: Transaction<DB>,
  values: {
    name?: string;
    rights?: "metadata_only" | "excerpt" | "full_text_internal";
    active?: boolean;
    topics?: string[];
  } = {},
): Promise<string> {
  const rights = values.rights ?? "full_text_internal";
  const row = await trx
    .insertInto("source")
    .values({
      name: values.name ?? `explore-${randomUUID()}`,
      feed_url: `https://${randomUUID()}.example.test/feed.xml`,
      rights_profile: rights,
      moments_seeded: rights === "full_text_internal",
      moments_enabled: rights === "full_text_internal",
      active: values.active ?? true,
      topics: values.topics ?? ["databases"],
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}

async function item(
  trx: Transaction<DB>,
  sourceId: string,
  values: {
    title?: string;
    author?: string;
    excerpt?: string;
    broken?: boolean;
    published?: Date;
  } = {},
): Promise<string> {
  const row = await trx
    .insertInto("content_item")
    .values({
      source_id: sourceId,
      guid: randomUUID(),
      canonical_url: `https://example.test/${randomUUID()}`,
      title: values.title ?? "An article",
      author: values.author ?? null,
      excerpt: values.excerpt ?? null,
      link_broken_at: values.broken === true ? new Date() : null,
      published_at: values.published ?? null,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}

async function moment(
  trx: Transaction<DB>,
  itemId: string,
  title: string,
  minutes = 3,
  ordinal = 0,
): Promise<string> {
  const row = await trx
    .insertInto("moment")
    .values({
      content_item_id: itemId,
      ordinal,
      title,
      estimated_minutes: minutes,
      link: `https://example.test/${randomUUID()}#s`,
      link_type: "anchor",
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}

async function concept(
  trx: Transaction<DB>,
  name: string,
  topic = "databases",
): Promise<string> {
  const row = await trx
    .insertInto("concept")
    .values({ slug: `explore-${randomUUID()}`, name, topic })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}

// Concept tags hang off a tagging row (AI-3).
async function tagItem(
  trx: Transaction<DB>,
  itemId: string,
  conceptId: string,
): Promise<void> {
  await trx
    .insertInto("item_tagging")
    .values({
      content_item_id: itemId,
      difficulty: "beginner",
      model: "test",
      prompt_version: 1,
    })
    .onConflict((c) => c.column("content_item_id").doNothing())
    .execute();
  await trx
    .insertInto("item_concept")
    .values({ content_item_id: itemId, concept_id: conceptId })
    .execute();
}

async function tagMoment(
  trx: Transaction<DB>,
  momentId: string,
  conceptId: string,
): Promise<void> {
  await trx
    .insertInto("moment_tagging")
    .values({ moment_id: momentId, difficulty: "beginner" })
    .onConflict((c) => c.column("moment_id").doNothing())
    .execute();
  await trx
    .insertInto("moment_concept")
    .values({ moment_id: momentId, concept_id: conceptId })
    .execute();
}

test("search finds an item by its title, author, source or concept, never its private text", async () => {
  await inRollback(async (trx) => {
    const explore = kyselyExplore(trx);
    const me = await user(trx);
    const [t, a, s, c, hidden] = [word(), word(), word(), word(), word()];
    const src = await source(trx, { name: `Weekly ${s}` });
    const byTitle = await item(trx, src, { title: `Indexes ${t}` });
    const byAuthor = await item(trx, src, { author: `Grace ${a}` });
    const byConcept = await item(trx, src);
    const conceptId = await concept(trx, `Idea ${c}`);
    await tagItem(trx, byConcept, conceptId);
    await trx
      .insertInto("content_item_private_text")
      .values({ content_item_id: byTitle, text: `Body text ${hidden}` })
      .execute();
    const ids = async (q: string) =>
      (await explore.search(me, q, 20)).map((r) => r.itemId);
    expect(await ids(t)).toEqual([byTitle]);
    expect(await ids(a)).toEqual([byAuthor]);
    expect(await ids(c)).toEqual([byConcept]);
    expect((await ids(s)).sort()).toEqual(
      [byTitle, byAuthor, byConcept].sort(),
    );
    // ING-2: full text for internal processing stays internal.
    expect(await ids(hidden)).toEqual([]);
  });
});

test("an excerpt is searched only where the source stores one; metadata_only by its metadata", async () => {
  await inRollback(async (trx) => {
    const explore = kyselyExplore(trx);
    const me = await user(trx);
    const [e, m] = [word(), word()];
    const excerptSource = await source(trx, { rights: "excerpt" });
    const withExcerpt = await item(trx, excerptSource, {
      excerpt: `A short excerpt about ${e}`,
    });
    const metadataSource = await source(trx, { rights: "metadata_only" });
    const metadataOnly = await item(trx, metadataSource, {
      title: `Caching ${m}`,
    });
    expect((await explore.search(me, e, 20)).map((r) => r.itemId)).toEqual([
      withExcerpt,
    ]);
    const [found] = await explore.search(me, m, 20);
    expect(found).toMatchObject({
      itemId: metadataOnly,
      momentId: null,
      title: `Caching ${m}`,
    });
  });
});

test("a matching section is the result's deep link, with its own title and minutes", async () => {
  await inRollback(async (trx) => {
    const explore = kyselyExplore(trx);
    const me = await user(trx);
    const w = word();
    const src = await source(trx);
    const itemId = await item(trx, src, { title: "Designing data systems" });
    await moment(trx, itemId, "Introduction", 2, 0);
    const section = await moment(trx, itemId, `Partitioning ${w}`, 6, 1);
    expect(await explore.search(me, w, 20)).toEqual([
      {
        itemId,
        momentId: section,
        title: `Partitioning ${w}`,
        articleTitle: "Designing data systems",
        sourceName: expect.any(String) as string,
        author: null,
        minutes: 6,
        saved: false,
        note: null,
      },
    ]);
  });
});

test("search leaves out hidden sources, broken links and switched-off sources", async () => {
  await inRollback(async (trx) => {
    const explore = kyselyExplore(trx);
    const me = await user(trx);
    const w = word();
    const hiddenSource = await source(trx);
    await item(trx, hiddenSource, { title: `Hidden ${w}` });
    await trx
      .insertInto("user_hidden_source")
      .values({ user_id: me, source_id: hiddenSource })
      .execute();
    await item(trx, await source(trx), { title: `Broken ${w}`, broken: true });
    await item(trx, await source(trx, { active: false }), {
      title: `Off ${w}`,
    });
    const shown = await item(trx, await source(trx), { title: `Shown ${w}` });
    expect((await explore.search(me, w, 20)).map((r) => r.itemId)).toEqual([
      shown,
    ]);
    // Another user didn't hide the source.
    const other = await user(trx);
    expect(await explore.search(other, w, 20)).toHaveLength(2);
  });
});

test("search covers the user's own notes and marks saves, and never another user's notes", async () => {
  await inRollback(async (trx) => {
    const explore = kyselyExplore(trx);
    const me = await user(trx);
    const other = await user(trx);
    const w = word();
    const itemId = await item(trx, await source(trx), { title: "Raft" });
    await trx
      .insertInto("user_note")
      .values({ user_id: me, content_item_id: itemId, body: `Ask about ${w}` })
      .execute();
    await trx
      .insertInto("user_save")
      .values({ user_id: me, content_item_id: itemId })
      .execute();
    expect(await explore.search(me, w, 20)).toEqual([
      expect.objectContaining({ itemId, saved: true, note: `Ask about ${w}` }),
    ]);
    expect(await explore.search(other, w, 20)).toEqual([]);
  });
});

test("spaces count learners and this week's unopened items per topic", async () => {
  await inRollback(async (trx) => {
    const explore = kyselyExplore(trx);
    const me = await user(trx);
    const now = new Date();
    const before = await explore.spaces(me, now);
    const learners = (topic: string, spaces: typeof before) =>
      spaces.find((s) => s.topic === topic)?.learners ?? -1;
    const fresh = (topic: string, spaces: typeof before) =>
      spaces.find((s) => s.topic === topic)?.fresh ?? -1;
    await trx
      .insertInto("user_preferences")
      .values({
        user_id: me,
        goals: ["stay-sharp"],
        topics: ["backend"],
        level: "beginner",
        break_length: "3-8",
      })
      .execute();
    const src = await source(trx, { topics: ["backend"] });
    const unopened = await item(trx, src);
    const opened = await item(trx, src);
    const openedMoment = await moment(trx, opened, "Section");
    await moment(trx, unopened, "Section");
    await trx
      .insertInto("user_moment_opened")
      .values({ user_id: me, moment_id: openedMoment })
      .execute();
    const after = await explore.spaces(me, now);
    expect(learners("backend", after)).toBe(learners("backend", before) + 1);
    expect(fresh("backend", after)).toBe(fresh("backend", before) + 1);
    // Older than a week: not new.
    await trx
      .updateTable("content_item")
      .set({ fetched_at: sql<Date>`now() - interval '8 days'` })
      .where("id", "=", unopened)
      .execute();
    expect(fresh("backend", await explore.spaces(me, now))).toBe(
      fresh("backend", before),
    );
  });
});

test("the gap is an unmastered concept between two mastered ones, at its shortest moment, until dismissed", async () => {
  await inRollback(async (trx) => {
    const explore = kyselyExplore(trx);
    const me = await user(trx);
    const [replication, caching, consistency, lonely] = await Promise.all([
      concept(trx, "Replication"),
      concept(trx, "Caching"),
      concept(trx, "Consistency models"),
      concept(trx, "Lonely"),
    ]);
    for (const id of [replication, caching])
      await trx
        .insertInto("concept_mastery")
        .values({
          user_id: me,
          concept_id: id,
          state: "mastered",
          probability: 0.97,
          evidence_count: 5,
        })
        .execute();
    await trx
      .insertInto("concept_edge")
      .values([
        { from_id: replication, to_id: consistency, type: "prerequisite_of" },
        { from_id: consistency, to_id: caching, type: "related_to" },
        { from_id: replication, to_id: lonely, type: "related_to" },
      ])
      .execute();
    const itemId = await item(trx, await source(trx));
    const long = await moment(trx, itemId, "Long", 9, 0);
    const short = await moment(trx, itemId, "Short", 4, 1);
    const lonelyMoment = await moment(trx, itemId, "Lonely", 1, 2);
    await tagMoment(trx, long, consistency);
    await tagMoment(trx, short, consistency);
    await tagMoment(trx, lonelyMoment, lonely);
    expect(await explore.gap(me)).toEqual({
      conceptId: consistency,
      concept: "Consistency models",
      topic: "databases",
      known: ["Caching", "Replication"],
      itemId,
      momentId: short,
      minutes: 4,
    });
    await explore.dismissGap(me, consistency);
    await explore.dismissGap(me, consistency);
    expect(await explore.gap(me)).toBeNull();
  });
});

test("saved most this week needs 5 savers, and leaves out what the user read or hid", async () => {
  await inRollback(async (trx) => {
    const explore = kyselyExplore(trx);
    const me = await user(trx);
    const savers = await Promise.all(
      Array.from({ length: 5 }, () => user(trx)),
    );
    const src = await source(trx, { topics: ["backend"] });
    const popular = await item(trx, src, { title: "Popular" });
    const fewer = await item(trx, src, { title: "Fewer" });
    const read = await item(trx, src, { title: "Read" });
    const hidden = await item(trx, src, { title: "Hidden" });
    const old = await item(trx, src, {
      title: "Old",
      published: new Date("2020-01-01"),
    });
    for (const [i, saver] of savers.entries())
      await trx
        .insertInto("user_save")
        .values(
          [popular, read, hidden, old, ...(i < 4 ? [fewer] : [])].map(
            (content_item_id) => ({ user_id: saver, content_item_id }),
          ),
        )
        .execute();
    await trx
      .insertInto("user_article_finished")
      .values({ user_id: me, content_item_id: read, method: "mark_done" })
      .execute();
    await trx
      .insertInto("item_feedback")
      .values({ user_id: me, content_item_id: hidden, kind: "not_interested" })
      .execute();
    await trx
      .updateTable("content_item")
      .set({ published_at: new Date() })
      .where("id", "=", popular)
      .execute();
    const now = new Date();
    const titles = async (
      tab: "everyone" | "spaces" | "new",
      followed: ("backend" | "databases")[] = [],
    ) =>
      (await explore.savedMost(me, tab, followed, now))
        .map((r) => r.title)
        .filter((t) =>
          ["Popular", "Fewer", "Read", "Hidden", "Old"].includes(t),
        );
    expect((await titles("everyone")).sort()).toEqual(["Old", "Popular"]);
    expect((await titles("spaces", ["backend"])).sort()).toEqual([
      "Old",
      "Popular",
    ]);
    expect(await titles("spaces", ["databases"])).toEqual([]);
    expect(await titles("new")).toEqual(["Popular"]);
  });
});
