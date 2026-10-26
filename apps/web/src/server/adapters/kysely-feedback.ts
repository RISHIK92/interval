import type { DB } from "@interval/db";
import { type Kysely, sql } from "kysely";
import type { Feedback } from "../ports";

// Inserts select from the item, so an item that doesn't exist writes nothing (no
// foreign-key error); `on conflict do nothing` makes a repeat a no-op.
export function kyselyFeedback(db: Kysely<DB>): Feedback {
  const item = (itemId: string) =>
    db.selectFrom("content_item").where("id", "=", itemId);
  return {
    give: async (userId, itemId, kind) => {
      const added = await db
        .insertInto("item_feedback")
        .columns(["user_id", "content_item_id", "kind"])
        .expression(
          item(itemId).select([
            sql<string>`${userId}`.as("user_id"),
            "id",
            sql<typeof kind>`${kind}::feedback_kind`.as("kind"),
          ]),
        )
        .onConflict((oc) => oc.doNothing())
        .returning("content_item_id")
        .execute();
      return added.length > 0;
    },
    undoNotInterested: async (userId, itemId) => {
      const removed = await db
        .deleteFrom("item_feedback")
        .where("user_id", "=", userId)
        .where("content_item_id", "=", itemId)
        .where("kind", "=", "not_interested")
        .returning("content_item_id")
        .execute();
      return removed.length > 0;
    },
    hideSource: async (userId, itemId) => {
      const added = await db
        .insertInto("user_hidden_source")
        .columns(["user_id", "source_id"])
        .expression(
          item(itemId).select([
            sql<string>`${userId}`.as("user_id"),
            "source_id",
          ]),
        )
        .onConflict((oc) => oc.doNothing())
        .returning("source_id")
        .execute();
      return added.length > 0;
    },
    save: async (userId, itemId) => {
      const added = await db
        .insertInto("user_save")
        .columns(["user_id", "content_item_id"])
        .expression(
          item(itemId).select([sql<string>`${userId}`.as("user_id"), "id"]),
        )
        .onConflict((oc) => oc.doNothing())
        .returning("content_item_id")
        .execute();
      return added.length > 0;
    },
    notInterested: async (userId, itemId) => {
      const row = await db
        .selectFrom("item_feedback")
        .select("content_item_id")
        .where("user_id", "=", userId)
        .where("content_item_id", "=", itemId)
        .where("kind", "=", "not_interested")
        .executeTakeFirst();
      return row !== undefined;
    },
  };
}
