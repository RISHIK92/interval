import { randomUUID } from "node:crypto";
import type { DB } from "@interval/db";
import { sql, type Transaction } from "kysely";
import { afterAll, expect, test } from "vitest";
import { createDb } from "./kysely";
import { kyselyNotes } from "./kysely-notes";

// Notes (§5I, Q-P2-01, P2-W7-S03): one private note per user on a section or an
// article, kept when re-segmenting removes its section.
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

test("a note is written, replaced and removed per section or article", async () => {
  await inRollback(async (trx, { userId, itemId, momentIds }) => {
    const notes = kyselyNotes(trx);
    const [, raft] = momentIds;
    if (raft === undefined) throw new Error("seed");
    expect(await notes.get(userId, itemId, raft)).toBeNull();
    expect(await notes.save(userId, itemId, raft, "Terms are epochs")).toBe(
      true,
    );
    expect(await notes.save(userId, itemId, null, "Whole article")).toBe(true);
    expect(await notes.save(userId, itemId, raft, "Terms are epochs!")).toBe(
      true,
    );
    expect(await notes.get(userId, itemId, raft)).toBe("Terms are epochs!");
    expect(await notes.get(userId, itemId, null)).toBe("Whole article");
    const rows = await trx
      .selectFrom("user_note")
      .select(["moment_id", "section_title"])
      .where("user_id", "=", userId)
      .orderBy("moment_id")
      .execute();
    // One per target, and the section's title kept with it.
    expect(rows).toEqual([
      { moment_id: raft, section_title: "Raft" },
      { moment_id: null, section_title: null },
    ]);
    expect(await notes.remove(userId, itemId, raft)).toBe(true);
    expect(await notes.remove(userId, itemId, raft)).toBe(false);
    expect(await notes.get(userId, itemId, raft)).toBeNull();
    expect(await notes.get(userId, itemId, null)).toBe("Whole article");
  });
});

test("ids that name no section of the article write nothing; notes are private", async () => {
  await inRollback(async (trx, { userId, itemId, momentIds }) => {
    const notes = kyselyNotes(trx);
    const [intro] = momentIds;
    if (intro === undefined) throw new Error("seed");
    expect(await notes.save(userId, "999999999999", null, "x")).toBe(false);
    expect(await notes.save(userId, "999999999999", intro, "x")).toBe(false);
    await notes.save(userId, itemId, intro, "mine");
    expect(await notes.get(`${userId}-other`, itemId, intro)).toBeNull();
    expect(await notes.remove(`${userId}-other`, itemId, intro)).toBe(false);
    expect(await notes.get(userId, itemId, intro)).toBe("mine");
  });
});

test("re-segmenting away a note's section keeps the note, on the article", async () => {
  await inRollback(async (trx, { userId, itemId, momentIds }) => {
    const notes = kyselyNotes(trx);
    const [, raft] = momentIds;
    if (raft === undefined) throw new Error("seed");
    await notes.save(userId, itemId, null, "On the article");
    await notes.save(userId, itemId, raft, "On Raft");
    await trx.deleteFrom("moment").where("id", "=", raft).execute();
    const rows = await trx
      .selectFrom("user_note")
      .select(["moment_id", "section_title", "body"])
      .where("user_id", "=", userId)
      .orderBy("body")
      .execute();
    expect(rows).toEqual([
      { moment_id: null, section_title: "Raft", body: "On Raft" },
      { moment_id: null, section_title: null, body: "On the article" },
    ]);
    // The article's own note is still the one edited as the article's.
    expect(await notes.get(userId, itemId, null)).toBe("On the article");
  });
});
