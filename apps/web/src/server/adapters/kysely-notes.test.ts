import { randomUUID } from "node:crypto";
import type { DB } from "@interval/db";
import { sql, type Transaction } from "kysely";
import { afterAll, expect, test } from "vitest";
import { createDb } from "./kysely";
import { kyselyNotes } from "./kysely-notes";

// Notes (§5I, Q-P2-01, P2-W7-S03): one private note per user on an article (ADR-0058).
const connectionString = process.env["DATABASE_URL"];
if (connectionString === undefined) {
  throw new Error("DATABASE_URL is not set; copy .env.example to .env");
}
const db = createDb(connectionString);

afterAll(async () => {
  await db.destroy();
});

class Rollback extends Error {}

type Seeded = { userId: string; itemId: string; otherItemId: string };

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
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      const [item, other] = await trx
        .insertInto("content_item")
        .values(
          ["Consensus in practice", "Leases"].map((title, n) => ({
            source_id: source.id,
            guid: `notes-${String(n)}`,
            canonical_url: `https://notes.example.test/post-${String(n)}`,
            title,
          })),
        )
        .returning("id")
        .execute();
      if (item === undefined || other === undefined) throw new Error("seed");
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
        otherItemId: other.id,
      });
      throw new Rollback();
    }),
  ).rejects.toBeInstanceOf(Rollback);
}

test("an article's note is written, replaced and removed", async () => {
  await inRollback(async (trx, { userId, itemId }) => {
    const notes = kyselyNotes(trx);
    expect(await notes.get(userId, itemId)).toBeNull();
    expect(await notes.save(userId, itemId, "Whole article")).toBe(true);
    expect(await notes.save(userId, itemId, "Whole article!")).toBe(true);
    expect(await notes.get(userId, itemId)).toBe("Whole article!");
    const rows = await trx
      .selectFrom("user_note")
      .select("body")
      .where("user_id", "=", userId)
      .execute();
    expect(rows).toEqual([{ body: "Whole article!" }]);
    expect(await notes.remove(userId, itemId)).toBe(true);
    expect(await notes.remove(userId, itemId)).toBe(false);
    expect(await notes.get(userId, itemId)).toBeNull();
    expect(await notes.onItems(userId, [itemId])).toEqual([]);
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

// P2-W7-S04: the Library's list, the cards' lookup, and edits by the note's own id.
test("the Library lists a user's notes newest first, with their article", async () => {
  await inRollback(async (trx, { userId, itemId, otherItemId }) => {
    const notes = kyselyNotes(trx);
    await notes.save(userId, itemId, "On the article");
    await notes.save(userId, otherItemId, "On leases");
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
        articleTitle: n.articleTitle,
        body: n.body,
      })),
    ).toEqual([
      { itemId: otherItemId, articleTitle: "Leases", body: "On leases" },
      {
        itemId,
        articleTitle: "Consensus in practice",
        body: "On the article",
      },
    ]);
    expect(listed[0]?.sourceName).toMatch(/^notes-/);
    expect(await notes.list(userId, 1)).toHaveLength(1);
  });
});

test("onItems gives the user's note on each article asked about", async () => {
  await inRollback(async (trx, { userId, itemId, otherItemId }) => {
    const notes = kyselyNotes(trx);
    await notes.save(userId, itemId, "On the article");
    await notes.save(userId, otherItemId, "On leases");
    expect(await notes.onItems(userId, [itemId, "999999999999"])).toEqual([
      { itemId, body: "On the article" },
    ]);
    expect(await notes.onItems(`${userId}-other`, [itemId])).toEqual([]);
    expect(await notes.onItems(userId, [])).toEqual([]);
  });
});

test("a note is edited and deleted by its id, only by its owner", async () => {
  await inRollback(async (trx, { userId, itemId }) => {
    const notes = kyselyNotes(trx);
    await notes.save(userId, itemId, "On Raft");
    const noteId = (await notes.list(userId, 1))[0]?.noteId;
    if (noteId === undefined) throw new Error("seed");
    expect(await notes.bodyById(userId, noteId)).toBe("On Raft");
    expect(await notes.bodyById(`${userId}-other`, noteId)).toBeNull();
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
