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
    hiddenSources: async (userId) => {
      const rows = await db
        .selectFrom("user_hidden_source as h")
        .innerJoin("source as s", "s.id", "h.source_id")
        .select(["s.id", "s.name"])
        .where("h.user_id", "=", userId)
        .orderBy("s.name")
        .execute();
      return rows.map((r) => ({ sourceId: r.id, name: r.name }));
    },
    unhideSource: async (userId, sourceId) => {
      const removed = await db
        .deleteFrom("user_hidden_source")
        .where("user_id", "=", userId)
        .where("source_id", "=", sourceId)
        .returning("source_id")
        .execute();
      return removed.length > 0;
    },
    inferred: async (userId) => {
      const rows = await db
        .selectFrom("item_feedback as f")
        .innerJoin("content_item as c", "c.id", "f.content_item_id")
        .select(["f.kind", "c.id", "c.title"])
        .where("f.user_id", "=", userId)
        .where("f.kind", "in", ["more_like_this", "less_like_this"])
        .orderBy("f.given_at", "desc")
        .execute();
      const concepts = await db
        .selectFrom("user_avoided_concept")
        .select(["slug", "name"])
        .where("user_id", "=", userId)
        .orderBy("name")
        .execute();
      const of = (kind: string) =>
        rows
          .filter((r) => r.kind === kind)
          .map((r) => ({ itemId: r.id, title: r.title }));
      return {
        more: of("more_like_this"),
        less: of("less_like_this"),
        avoidedConcepts: concepts.flatMap((c) =>
          c.slug === null || c.name === null
            ? []
            : [{ slug: c.slug, name: c.name }],
        ),
      };
    },
    resetInferred: async (userId) => {
      // One transaction: the cleared feedback and the reset time land together. A
      // caller's transaction (a unit of work, or a test) is joined, not nested.
      const atomically = (work: (trx: Kysely<DB>) => Promise<void>) =>
        db.isTransaction ? work(db) : db.transaction().execute(work);
      await atomically(async (trx) => {
        await trx
          .deleteFrom("item_feedback")
          .where("user_id", "=", userId)
          .where("kind", "in", ["more_like_this", "less_like_this"])
          .execute();
        await trx
          .insertInto("user_inferred_reset")
          .values({ user_id: userId, reset_at: sql<Date>`clock_timestamp()` })
          .onConflict((oc) =>
            oc
              .column("user_id")
              .doUpdateSet({ reset_at: sql<Date>`clock_timestamp()` }),
          )
          .execute();
      });
    },
    unsave: async (userId, itemId) => {
      const removed = await db
        .deleteFrom("user_save")
        .where("user_id", "=", userId)
        .where("content_item_id", "=", itemId)
        .returning("content_item_id")
        .execute();
      return removed.length > 0;
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
