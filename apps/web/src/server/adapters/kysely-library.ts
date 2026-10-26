import type { DB } from "@interval/db";
import { type Kysely, sql } from "kysely";
import type { Library } from "../ports";

// How far the user read item `c` (owner, 2026-10-26): finished sections, all of them,
// a whole-article finish, the first section not finished, and whether it frames.
const progress = (userId: string) => sql`
  (select count(*) from user_moment_finished f join moment m on m.id = f.moment_id
   where f.user_id = ${userId} and m.content_item_id = c.id)::integer as finished_sections,
  (select count(*) from moment where content_item_id = c.id)::integer as total_sections,
  exists (select 1 from user_article_finished
          where user_id = ${userId} and content_item_id = c.id) as whole,
  (select m.id from moment m
   where m.content_item_id = c.id
     and not exists (select 1 from user_moment_finished f
                     where f.user_id = ${userId} and f.moment_id = m.id)
   order by m.ordinal limit 1) as next_moment_id,
  coalesce(c.frameable, false) as frameable,
  c.link_broken_at is not null as link_broken`;

type ProgressRow = {
  finished_sections: number;
  total_sections: number;
  whole: boolean;
  next_moment_id: string | null;
  frameable: boolean;
  link_broken: boolean;
};

function toProgress(r: ProgressRow) {
  const finished =
    r.whole ||
    (r.total_sections > 0 && r.finished_sections >= r.total_sections);
  return {
    finishedSections: r.finished_sections,
    totalSections: r.total_sections,
    finished,
    nextMomentId: finished ? null : r.next_moment_id,
    frameable: r.frameable,
    linkBroken: r.link_broken,
  };
}

// Saves and history (§5I, P1-W5-S04): titles and source names only, never text.
export function kyselyLibrary(db: Kysely<DB>): Library {
  return {
    saves: async (userId, limit) => {
      const rows = await sql<
        ProgressRow & {
          item_id: string;
          article_title: string;
          source_name: string;
          saved_at: Date;
        }
      >`
        select c.id as item_id, c.title as article_title, s.name as source_name,
               us.saved_at, ${progress(userId)}
        from user_save us
        join content_item c on c.id = us.content_item_id
        join source s on s.id = c.source_id
        where us.user_id = ${userId}
        order by us.saved_at desc, c.id desc
        limit ${limit}
      `.execute(db);
      return rows.rows.map((r) => ({
        itemId: r.item_id,
        articleTitle: r.article_title,
        sourceName: r.source_name,
        savedAt: r.saved_at,
        ...toProgress(r),
      }));
    },
    history: async (userId, limit) => {
      const rows = await sql<
        ProgressRow & {
          item_id: string;
          article_title: string;
          source_name: string;
          last_at: Date;
        }
      >`
        with done as (
          select m.content_item_id as item_id, max(f.finished_at) as last_at
          from user_moment_finished f join moment m on m.id = f.moment_id
          where f.user_id = ${userId}
          group by m.content_item_id
        ),
        items as (
          select item_id, last_at from done
          union all
          select content_item_id, finished_at from user_article_finished
          where user_id = ${userId}
        ),
        per_item as (
          select item_id, max(last_at) as last_at from items group by item_id
        )
        select p.item_id, c.title as article_title, s.name as source_name,
               p.last_at, ${progress(userId)}
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
        lastFinishedAt: r.last_at,
        ...toProgress(r),
      }));
    },
  };
}
