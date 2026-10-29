import type { DB } from "@interval/db";
import { type Kysely, sql } from "kysely";
import type { OutboundLink, OutboundLinks } from "../ports";

export function kyselyOutboundLinks(db: Kysely<DB>): OutboundLinks {
  const resolve = async (
    itemId: string,
    momentId: string | null,
  ): Promise<OutboundLink | null> => {
    if (momentId !== null) {
      const moment = await db
        .selectFrom("moment as m")
        .innerJoin("content_item as c", "c.id", "m.content_item_id")
        .innerJoin("source as s", "s.id", "c.source_id")
        .select(["m.link", "m.link_type"])
        .where("m.id", "=", momentId)
        .where("m.content_item_id", "=", itemId)
        .where("s.moments_enabled", "=", true)
        .where("s.rights_profile", "in", [
          "full_text_internal",
          "full_text_display",
        ])
        .executeTakeFirst();
      if (moment !== undefined) {
        return { url: moment.link, linkType: moment.link_type };
      }
    }
    const item = await db
      .selectFrom("content_item")
      .select("canonical_url")
      .where("id", "=", itemId)
      .executeTakeFirst();
    return item === undefined
      ? null
      : { url: item.canonical_url, linkType: "article" };
  };
  return {
    resolve,
    reader: async (userId, itemId, momentId) => {
      const link = await resolve(itemId, momentId);
      if (link === null) return null;
      // The section really reached: resolve() fell back to the page otherwise.
      const reached = link.linkType === "article" ? null : momentId;
      const item = await db
        .selectFrom("content_item as c")
        .innerJoin("source as s", "s.id", "c.source_id")
        .select(["c.title", "c.frameable", "s.name"])
        .select(
          sql<boolean>`exists (
            select 1 from user_save us
            where us.user_id = ${userId} and us.content_item_id = c.id
          )`.as("saved"),
        )
        .where("c.id", "=", itemId)
        .executeTakeFirstOrThrow();
      const section =
        reached === null
          ? undefined
          : await db
              .selectFrom("moment")
              .select(["title", "ordinal"])
              .where("id", "=", reached)
              .executeTakeFirstOrThrow();
      // resolve() checked the source allows moments; the next one shares the source.
      const next =
        section === undefined
          ? undefined
          : await db
              .selectFrom("moment")
              .select("id")
              .where("content_item_id", "=", itemId)
              .where("ordinal", ">", section.ordinal)
              .orderBy("ordinal")
              .limit(1)
              .executeTakeFirst();
      // An entry may sit in more than one chip; its reasons are the same entry's.
      const entry = await db
        .selectFrom("user_feed_entry as fe")
        .select("fe.reasons")
        .where("fe.user_id", "=", userId)
        .where("fe.content_item_id", "=", itemId)
        .where("fe.moment_id", reached === null ? "is" : "=", reached)
        .where("fe.reasons", "is not", null)
        .limit(1)
        .executeTakeFirst();
      return {
        link,
        frameable: item.frameable === true,
        articleTitle: item.title,
        sectionTitle: section?.title ?? null,
        sourceName: item.name,
        reasons: entry?.reasons ?? null,
        saved: item.saved,
        nextMomentId: next?.id ?? null,
      };
    },
  };
}
