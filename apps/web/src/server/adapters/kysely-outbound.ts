import type { DB } from "@interval/db";
import type { Kysely } from "kysely";
import type { OutboundLinks } from "../ports";

export function kyselyOutboundLinks(db: Kysely<DB>): OutboundLinks {
  return {
    resolve: async (itemId, momentId) => {
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
    },
  };
}
