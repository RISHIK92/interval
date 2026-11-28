import type { DB } from "@interval/db";
import { type Kysely, sql } from "kysely";
import { FEED_CHIP, type OutboundLink, type OutboundLinks } from "../ports";

// ADR-0058: a link is always the article's own page, which every rights profile
// allows (a deep link, never a copy: §3.2).
export function kyselyOutboundLinks(db: Kysely<DB>): OutboundLinks {
  const resolve = async (itemId: string): Promise<OutboundLink | null> => {
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
    reader: async (userId, itemId) => {
      const item = await db
        .selectFrom("content_item as c")
        .innerJoin("source as s", "s.id", "c.source_id")
        .select(["c.canonical_url", "c.title", "c.frameable", "s.name"])
        .select(sql<number | null>`item_minutes(c.id)`.as("minutes"))
        .select(
          sql<boolean>`exists (
            select 1 from user_save us
            where us.user_id = ${userId} and us.content_item_id = c.id
          )`.as("saved"),
        )
        .select(
          sql<boolean>`exists (
            select 1 from user_article_finished f
            where f.user_id = ${userId} and f.content_item_id = c.id
          )`.as("completed"),
        )
        .select(
          sql<boolean>`exists (
            select 1 from user_article_opened o
            where o.user_id = ${userId} and o.content_item_id = c.id
          )`.as("opened"),
        )
        .where("c.id", "=", itemId)
        .executeTakeFirst();
      if (item === undefined) return null;
      // ADR-0058: the feed's one list of articles until stage C drops the chip.
      const entry = await db
        .selectFrom("user_feed_entry")
        .select("reasons")
        .where("user_id", "=", userId)
        .where("chip", "=", FEED_CHIP)
        .where("content_item_id", "=", itemId)
        .where("moment_id", "is", null)
        .where("reasons", "is not", null)
        .executeTakeFirst();
      return {
        link: { url: item.canonical_url, linkType: "article" },
        frameable: item.frameable === true,
        articleTitle: item.title,
        sourceName: item.name,
        reasons: entry?.reasons ?? null,
        saved: item.saved,
        state: item.completed
          ? "completed"
          : item.opened
            ? "continue_reading"
            : "unread",
        estimatedMinutes: item.minutes,
      };
    },
  };
}
