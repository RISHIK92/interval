import type { DB } from "@interval/db";
import { type ExpressionBuilder, type Kysely, sql } from "kysely";
import type { Notes } from "../ports";

// A note's target: the section, or the article itself (no moment, no section title).
// A note whose section was re-segmented away has no moment but keeps its section's
// title; it is not the article's note (see the migration's two unique indexes).
const onTarget =
  (momentId: string | null) => (eb: ExpressionBuilder<DB, "user_note">) =>
    momentId === null
      ? eb.and([eb("moment_id", "is", null), eb("section_title", "is", null)])
      : eb("moment_id", "=", momentId);

export function kyselyNotes(db: Kysely<DB>): Notes {
  return {
    get: async (userId, itemId, momentId) => {
      const row = await db
        .selectFrom("user_note")
        .select("body")
        .where("user_id", "=", userId)
        .where("content_item_id", "=", itemId)
        .where(onTarget(momentId))
        .executeTakeFirst();
      return row?.body ?? null;
    },
    // One upsert per target, against its unique index; the insert selects from the
    // article (and the section, which must be the article's), so ids that name nothing
    // write nothing. A section's title is refreshed on every save.
    save: async (userId, itemId, momentId, body) => {
      const saved =
        momentId === null
          ? await sql<{ id: string }>`
              insert into user_note (user_id, content_item_id, body)
              select ${userId}, id, ${body} from content_item where id = ${itemId}
              on conflict (user_id, content_item_id)
                where moment_id is null and section_title is null
              do update set body = excluded.body, updated_at = now()
              returning id
            `.execute(db)
          : await sql<{ id: string }>`
              insert into user_note
                (user_id, content_item_id, moment_id, section_title, body)
              select ${userId}, m.content_item_id, m.id, m.title, ${body}
              from moment m
              where m.id = ${momentId} and m.content_item_id = ${itemId}
              on conflict (user_id, moment_id) where moment_id is not null
              do update set
                body = excluded.body,
                section_title = excluded.section_title,
                updated_at = now()
              returning id
            `.execute(db);
      return saved.rows.length > 0;
    },
    remove: async (userId, itemId, momentId) => {
      const removed = await db
        .deleteFrom("user_note")
        .where("user_id", "=", userId)
        .where("content_item_id", "=", itemId)
        .where(onTarget(momentId))
        .returning("id")
        .execute();
      return removed.length > 0;
    },
  };
}
