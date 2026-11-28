import type { DB } from "@interval/db";
import { type ExpressionBuilder, type Kysely, sql } from "kysely";
import type { Notes } from "../ports";

// ADR-0058: the article's own note has no moment and no section title (see the notes
// migration's unique indexes). Notes written on a section before it keep their
// section's title and are only listed, edited or deleted by id until stage C joins them
// into the article's note.
const articleNote = (eb: ExpressionBuilder<DB, "user_note">) =>
  eb.and([eb("moment_id", "is", null), eb("section_title", "is", null)]);

export function kyselyNotes(db: Kysely<DB>): Notes {
  return {
    get: async (userId, itemId) => {
      const row = await db
        .selectFrom("user_note")
        .select("body")
        .where("user_id", "=", userId)
        .where("content_item_id", "=", itemId)
        .where(articleNote)
        .executeTakeFirst();
      return row?.body ?? null;
    },
    // One upsert against the article note's unique index; the insert selects from the
    // article, so an id that names nothing writes nothing.
    save: async (userId, itemId, body) => {
      const saved = await sql<{ id: string }>`
        insert into user_note (user_id, content_item_id, body)
        select ${userId}, id, ${body} from content_item where id = ${itemId}
        on conflict (user_id, content_item_id)
          where moment_id is null and section_title is null
        do update set body = excluded.body, updated_at = now()
        returning id
      `.execute(db);
      return saved.rows.length > 0;
    },
    remove: async (userId, itemId) => {
      const removed = await db
        .deleteFrom("user_note")
        .where("user_id", "=", userId)
        .where("content_item_id", "=", itemId)
        .where(articleNote)
        .returning("id")
        .execute();
      return removed.length > 0;
    },
    list: async (userId, limit) => {
      const rows = await db
        .selectFrom("user_note as n")
        .innerJoin("content_item as c", "c.id", "n.content_item_id")
        .innerJoin("source as s", "s.id", "c.source_id")
        .select([
          "n.id",
          "n.content_item_id",
          "n.section_title",
          "n.body",
          "c.title",
          "c.frameable",
          "c.link_broken_at",
          "s.name",
        ])
        .where("n.user_id", "=", userId)
        .orderBy("n.updated_at", "desc")
        .orderBy("n.id", "desc")
        .limit(limit)
        .execute();
      return rows.map((r) => ({
        noteId: r.id,
        itemId: r.content_item_id,
        sectionTitle: r.section_title,
        articleTitle: r.title,
        sourceName: r.name,
        body: r.body,
        frameable: r.frameable === true,
        linkBroken: r.link_broken_at !== null,
      }));
    },
    onItems: async (userId, itemIds) => {
      if (itemIds.length === 0) return [];
      const rows = await db
        .selectFrom("user_note as n")
        .leftJoin("moment as m", "m.id", "n.moment_id")
        .select(["n.content_item_id", "n.section_title", "n.body"])
        .where("n.user_id", "=", userId)
        .where("n.content_item_id", "in", itemIds)
        // The article's own note first, then its section notes in page order (one
        // whose section was re-segmented away last).
        .orderBy("n.content_item_id")
        .orderBy(sql`n.section_title is not null`)
        .orderBy(sql`m.ordinal`, (ob) => ob.asc().nullsLast())
        .orderBy("n.id")
        .execute();
      return rows.map((r) => ({
        itemId: r.content_item_id,
        sectionTitle: r.section_title,
        body: r.body,
      }));
    },
    update: async (userId, noteId, body) => {
      const row = await db
        .updateTable("user_note")
        .set({ body, updated_at: sql<Date>`now()` })
        .where("id", "=", noteId)
        .where("user_id", "=", userId)
        .returning("content_item_id")
        .executeTakeFirst();
      return row === undefined ? null : { itemId: row.content_item_id };
    },
    removeById: async (userId, noteId) => {
      const row = await db
        .deleteFrom("user_note")
        .where("id", "=", noteId)
        .where("user_id", "=", userId)
        .returning("content_item_id")
        .executeTakeFirst();
      return row === undefined ? null : { itemId: row.content_item_id };
    },
  };
}
