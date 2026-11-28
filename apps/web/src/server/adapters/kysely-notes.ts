import type { DB } from "@interval/db";
import { type Kysely, sql } from "kysely";
import type { Notes } from "../ports";

// One note per user and article (user_note_one_per_article).

export function kyselyNotes(db: Kysely<DB>): Notes {
  return {
    get: async (userId, itemId) => {
      const row = await db
        .selectFrom("user_note")
        .select("body")
        .where("user_id", "=", userId)
        .where("content_item_id", "=", itemId)
        .executeTakeFirst();
      return row?.body ?? null;
    },
    // One upsert against the note's unique key; the insert selects from the article, so
    // an id that names nothing writes nothing.
    save: async (userId, itemId, body) => {
      const saved = await sql<{ id: string }>`
        insert into user_note (user_id, content_item_id, body)
        select ${userId}, id, ${body} from content_item where id = ${itemId}
        on conflict (user_id, content_item_id)
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
        .selectFrom("user_note")
        .select(["content_item_id", "body"])
        .where("user_id", "=", userId)
        .where("content_item_id", "in", itemIds)
        .orderBy("content_item_id")
        .execute();
      return rows.map((r) => ({ itemId: r.content_item_id, body: r.body }));
    },
    bodyById: async (userId, noteId) => {
      const row = await db
        .selectFrom("user_note")
        .select("body")
        .where("id", "=", noteId)
        .where("user_id", "=", userId)
        .executeTakeFirst();
      return row?.body ?? null;
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
