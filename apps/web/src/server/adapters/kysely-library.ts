import type { DB } from "@interval/db";
import { type Kysely, sql } from "kysely";
import type { Library } from "../ports";

// Saves and history (§5I, P1-W5-S04): titles and source names only, never text.
export function kyselyLibrary(db: Kysely<DB>): Library {
  return {
    saves: async (userId, limit) => {
      const rows = await db
        .selectFrom("user_save as us")
        .innerJoin("content_item as c", "c.id", "us.content_item_id")
        .innerJoin("source as s", "s.id", "c.source_id")
        .select([
          "c.id",
          "c.title",
          "s.name",
          "us.saved_at",
          "c.link_broken_at",
        ])
        .where("us.user_id", "=", userId)
        .orderBy("us.saved_at", "desc")
        .orderBy("c.id", "desc")
        .limit(limit)
        .execute();
      return rows.map((r) => ({
        itemId: r.id,
        articleTitle: r.title,
        sourceName: r.name,
        savedAt: r.saved_at,
        linkBroken: r.link_broken_at !== null,
      }));
    },
    history: async (userId, limit) => {
      const rows = await sql<{
        item_id: string;
        article_title: string;
        source_name: string;
        finished_sections: number;
        total_sections: number;
        whole: boolean;
        last_at: Date;
        link_broken: boolean;
      }>`
        with done as (
          select m.content_item_id as item_id, count(*)::integer as n,
                 max(f.finished_at) as last_at
          from user_moment_finished f join moment m on m.id = f.moment_id
          where f.user_id = ${userId}
          group by m.content_item_id
        ),
        items as (
          select item_id, n, last_at, false as whole from done
          union all
          select content_item_id, 0, finished_at, true from user_article_finished
          where user_id = ${userId}
        ),
        per_item as (
          select item_id, max(n) as n, max(last_at) as last_at, bool_or(whole) as whole
          from items group by item_id
        )
        select p.item_id, c.title as article_title, s.name as source_name,
               p.n as finished_sections,
               (select count(*) from moment where content_item_id = p.item_id)::integer
                 as total_sections,
               p.whole, p.last_at, c.link_broken_at is not null as link_broken
        from per_item p
        join content_item c on c.id = p.item_id
        join source s on s.id = c.source_id
        order by p.last_at desc, p.item_id desc
        limit ${limit}
      `.execute(db);
      return rows.rows.map((r) => ({
        itemId: r.item_id,
        articleTitle: r.article_title,
        sourceName: r.source_name,
        finishedSections: r.finished_sections,
        totalSections: r.total_sections,
        finished:
          r.whole ||
          (r.total_sections > 0 && r.finished_sections >= r.total_sections),
        lastFinishedAt: r.last_at,
        linkBroken: r.link_broken,
      }));
    },
  };
}
