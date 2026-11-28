import { randomUUID } from "node:crypto";
import type { DB } from "@interval/db";
import { sql, type Transaction } from "kysely";
import { afterAll, expect, test } from "vitest";
import { createDb } from "./kysely";
import { kyselyNotes } from "./kysely-notes";

// Notes (§5I, Q-P2-01, P2-W7-S03): one private note per user on an article (ADR-0058).
// Notes written on a section before it are still listed, under their section's title,
// until stage C joins them into the article's note.
const connectionString = process.env["DATABASE_URL"];
if (connectionString === undefined) {
  throw new Error("DATABASE_URL is not set; copy .env.example to .env");
}
const db = createDb(connectionString);

afterAll(async () => {
  await db.destroy();
});

class Rollback extends Error {}

type Seeded = { userId: string; itemId: string; momentIds: string[] };

async function inRollback(
  body: (trx: Transaction<DB>, seeded: Seeded) => Promise<void>,
): Promise<void> {
  await expect(
    db.transaction().execute(async (trx) => {
      const source = await trx
        .insertInto("source")
        .values({
          name: `notes-${randomUUID()}`,
          feed_url: "https://notes.example.test/feed.xml",
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
          guid: "notes-1",
          canonical_url: "https://notes.example.test/post",
          title: "Consensus in practice",
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      const moments = await trx
        .insertInto("moment")
        .values(
          ["Intro", "Raft"].map((title, ordinal) => ({
            content_item_id: item.id,
            ordinal,
            title,
            estimated_minutes: 3,
            link: `https://notes.example.test/post#${title.toLowerCase()}`,
            link_type: "anchor" as const,
          })),
        )
        .returning("id")
        .execute();
      const code = await trx
        .insertInto("invite_code")
        .values({
          code: `NOTE${randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`,
          beta_group: "student",
          max_uses: 2,
          expires_at: sql<Date>`now() + interval '1 day'`,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      const userId = randomUUID();
      for (const id of [userId, `${userId}-other`]) {
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
      await body(trx, {
        userId,
        itemId: item.id,
        momentIds: moments.map((m) => m.id),
      });
      throw new Rollback();
    }),
  ).rejects.toBeInstanceOf(Rollback);
}

// An earlier section note, as the web wrote them before ADR-0058.
async function sectionNote(
  trx: Transaction<DB>,
  userId: string,
  itemId: string,
  momentId: string,
  body: string,
) {
  const moment = await trx
    .selectFrom("moment")
    .select("title")
    .where("id", "=", momentId)
    .executeTakeFirstOrThrow();
  const row = await trx
    .insertInto("user_note")
    .values({
      user_id: userId,
      content_item_id: itemId,
      moment_id: momentId,
      section_title: moment.title,
      body,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}

test("an article's note is written, replaced and removed, beside earlier section notes", async () => {
  await inRollback(async (trx, { userId, itemId, momentIds }) => {
    const notes = kyselyNotes(trx);
    const [, raft] = momentIds;
    if (raft === undefined) throw new Error("seed");
    await sectionNote(trx, userId, itemId, raft, "Terms are epochs");
    expect(await notes.get(userId, itemId)).toBeNull();
    expect(await notes.save(userId, itemId, "Whole article")).toBe(true);
    expect(await notes.save(userId, itemId, "Whole article!")).toBe(true);
    expect(await notes.get(userId, itemId)).toBe("Whole article!");
    const rows = await trx
      .selectFrom("user_note")
      .select(["moment_id", "section_title", "body"])
      .where("user_id", "=", userId)
      .orderBy("moment_id")
      .execute();
    // ADR-0058: a new note is on the article (no moment); the section note stays.
    expect(rows).toEqual([
      { moment_id: raft, section_title: "Raft", body: "Terms are epochs" },
      { moment_id: null, section_title: null, body: "Whole article!" },
    ]);
    expect(await notes.remove(userId, itemId)).toBe(true);
    expect(await notes.remove(userId, itemId)).toBe(false);
    expect(await notes.get(userId, itemId)).toBeNull();
    expect(await notes.onItems(userId, [itemId])).toEqual([
      { itemId, sectionTitle: "Raft", body: "Terms are epochs" },
    ]);
  });
});

test("an id that names no article writes nothing; notes are private", async () => {
  await inRollback(async (trx, { userId, itemId }) => {
    const notes = kyselyNotes(trx);
    expect(await notes.save(userId, "999999999999", "x")).toBe(false);
    await notes.save(userId, itemId, "mine");
    expect(await notes.get(`${userId}-other`, itemId)).toBeNull();
    expect(await notes.remove(`${userId}-other`, itemId)).toBe(false);
    expect(await notes.get(userId, itemId)).toBe("mine");
  });
});

// P2-W7-S04: the Library's list, the cards' lookup, and edits by the note's own id,
// which also reach an earlier section note.
test("the Library lists a user's notes newest first, with their article and section", async () => {
  await inRollback(async (trx, { userId, itemId, momentIds }) => {
    const notes = kyselyNotes(trx);
    const [, raft] = momentIds;
    if (raft === undefined) throw new Error("seed");
    await notes.save(userId, itemId, "On the article");
    await sectionNote(trx, userId, itemId, raft, "On Raft");
    await notes.save(`${userId}-other`, itemId, "Someone else's");
    await trx
      .updateTable("user_note")
      .set({ updated_at: new Date("2026-10-01T00:00:00Z") })
      .where("body", "=", "On the article")
      .execute();
    const listed = await notes.list(userId, 10);
    expect(
      listed.map((n) => ({
        itemId: n.itemId,
        sectionTitle: n.sectionTitle,
        articleTitle: n.articleTitle,
        body: n.body,
      })),
    ).toEqual([
      {
        itemId,
        sectionTitle: "Raft",
        articleTitle: "Consensus in practice",
        body: "On Raft",
      },
      {
        itemId,
        sectionTitle: null,
        articleTitle: "Consensus in practice",
        body: "On the article",
      },
    ]);
    expect(listed[0]?.sourceName).toMatch(/^notes-/);
    expect(await notes.list(userId, 1)).toHaveLength(1);
  });
});

// ADR-0058: cards and the reader show the article's note first, then its earlier
// section notes, a re-segmented-away one included.
test("onItems gives the article's note and its earlier section notes", async () => {
  await inRollback(async (trx, { userId, itemId, momentIds }) => {
    const notes = kyselyNotes(trx);
    const [intro, raft] = momentIds;
    if (intro === undefined || raft === undefined) throw new Error("seed");
    await sectionNote(trx, userId, itemId, intro, "On the intro");
    await sectionNote(trx, userId, itemId, raft, "On Raft");
    await notes.save(userId, itemId, "On the article");
    await trx.deleteFrom("moment").where("id", "=", raft).execute();
    expect(await notes.onItems(userId, [itemId, "999999999999"])).toEqual([
      { itemId, sectionTitle: null, body: "On the article" },
      { itemId, sectionTitle: "Intro", body: "On the intro" },
      { itemId, sectionTitle: "Raft", body: "On Raft" },
    ]);
    expect(await notes.onItems(`${userId}-other`, [itemId])).toEqual([]);
    expect(await notes.onItems(userId, [])).toEqual([]);
  });
});

test("a note is edited and deleted by its id, a section note included, only by its owner", async () => {
  await inRollback(async (trx, { userId, itemId, momentIds }) => {
    const notes = kyselyNotes(trx);
    const [, raft] = momentIds;
    if (raft === undefined) throw new Error("seed");
    const noteId = await sectionNote(trx, userId, itemId, raft, "On Raft");
    expect(await notes.update(`${userId}-other`, noteId, "x")).toBeNull();
    expect(await notes.update(userId, noteId, "Still on Raft")).toEqual({
      itemId,
    });
    expect((await notes.list(userId, 10))[0]?.body).toBe("Still on Raft");
    expect(await notes.removeById(`${userId}-other`, noteId)).toBeNull();
    expect(await notes.removeById(userId, noteId)).toEqual({ itemId });
    expect(await notes.list(userId, 10)).toEqual([]);
  });
});
