import type { DB } from "@interval/db";
import { type Kysely, sql } from "kysely";
import type { Progress } from "../ports";

// Inserts select from the moment or item, so ids that name nothing write nothing; `on
// conflict do nothing` keeps the first finish.
export function kyselyProgress(db: Kysely<DB>): Progress {
  // Moments a source still allows (ING-2), as user_feed_visible and /out gate them.
  const allowedMoments = () =>
    db
      .selectFrom("moment as m")
      .innerJoin("content_item as c", "c.id", "m.content_item_id")
      .innerJoin("source as s", "s.id", "c.source_id")
      .where("s.moments_enabled", "=", true)
      .where("s.rights_profile", "in", [
        "full_text_internal",
        "full_text_display",
      ]);
  return {
    finishMoment: async (userId, itemId, momentId, method) => {
      const added = await db
        .insertInto("user_moment_finished")
        .columns(["user_id", "moment_id", "method"])
        .expression(
          db
            .selectFrom("moment")
            .select([
              sql<string>`${userId}`.as("user_id"),
              "id",
              sql<typeof method>`${method}::finish_method`.as("method"),
            ])
            .where("id", "=", momentId)
            .where("content_item_id", "=", itemId),
        )
        .onConflict((oc) => oc.doNothing())
        .returning("moment_id")
        .execute();
      return added.length > 0;
    },
    finishArticle: async (userId, itemId, method) => {
      const added = await db
        .insertInto("user_article_finished")
        .columns(["user_id", "content_item_id", "method"])
        .expression(
          db
            .selectFrom("content_item")
            .select([
              sql<string>`${userId}`.as("user_id"),
              "id",
              sql<typeof method>`${method}::finish_method`.as("method"),
            ])
            .where("id", "=", itemId),
        )
        .onConflict((oc) => oc.doNothing())
        .returning("content_item_id")
        .execute();
      return added.length > 0;
    },
    describe: async (itemId, momentId) => {
      const item = await db
        .selectFrom("content_item")
        .select("title")
        .where("id", "=", itemId)
        .executeTakeFirst();
      if (item === undefined) return null;
      if (momentId === null)
        return { articleTitle: item.title, sectionTitle: null };
      const moment = await allowedMoments()
        .select("m.title")
        .where("m.id", "=", momentId)
        .where("m.content_item_id", "=", itemId)
        .executeTakeFirst();
      return moment === undefined
        ? null
        : { articleTitle: item.title, sectionTitle: moment.title };
    },
    nextMoment: async (itemId, momentId) => {
      const next = await allowedMoments()
        .select(["m.id", "m.title"])
        .where("m.content_item_id", "=", itemId)
        .where(
          "m.ordinal",
          ">",
          db
            .selectFrom("moment")
            .select("ordinal")
            .where("id", "=", momentId)
            .where("content_item_id", "=", itemId),
        )
        .orderBy("m.ordinal")
        .limit(1)
        .executeTakeFirst();
      return next === undefined
        ? null
        : { momentId: next.id, title: next.title };
    },
  };
}
