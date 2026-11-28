import type { DB } from "@interval/db";
import { type Kysely, sql } from "kysely";
import type { ArticleState, Library } from "../ports";

// ADR-0058: how far the user read item `c` is its state alone (completed, opened, or
// neither), and whether it frames.
const progress = (userId: string) => sql`
  exists (select 1 from user_article_finished
          where user_id = ${userId} and content_item_id = c.id) as completed,
  exists (select 1 from user_article_opened
          where user_id = ${userId} and content_item_id = c.id) as opened,
  coalesce(c.frameable, false) as frameable,
  c.link_broken_at is not null as link_broken`;

type ProgressRow = {
  completed: boolean;
  opened: boolean;
  frameable: boolean;
  link_broken: boolean;
};

function toProgress(r: ProgressRow) {
  const state: ArticleState = r.completed
    ? "completed"
    : r.opened
      ? "continue_reading"
      : "unread";
  return { state, frameable: r.frameable, linkBroken: r.link_broken };
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
        -- ADR-0058: an article is read when it was last opened, or when completed.
        with reads as (
          select content_item_id as item_id, last_opened_at as at
          from user_article_opened where user_id = ${userId}
          union all
          select content_item_id, finished_at from user_article_finished
          where user_id = ${userId}
        ),
        per_item as (
          select item_id, max(at) as last_at from reads group by item_id
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
        lastReadAt: r.last_at,
        ...toProgress(r),
      }));
    },
  };
}
