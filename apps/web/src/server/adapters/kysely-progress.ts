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
    finishArticleIfComplete: async (userId, itemId, method) => {
      const added = await sql<{ content_item_id: string }>`
        insert into user_article_finished (user_id, content_item_id, method)
        select ${userId}, ${itemId}, ${method}::finish_method
        where exists (select 1 from moment where content_item_id = ${itemId})
          and not exists (
            select 1 from moment m
            where m.content_item_id = ${itemId}
              and not exists (
                select 1 from user_moment_finished f
                where f.user_id = ${userId} and f.moment_id = m.id
              )
          )
        on conflict do nothing
        returning content_item_id
      `.execute(db);
      return added.rows.length > 0;
    },
    recordOpen: async (userId, itemId, momentId) => {
      await sql`
        insert into user_moment_opened (user_id, moment_id)
        select ${userId}, m.id from moment m
        where m.id = ${momentId} and m.content_item_id = ${itemId}
        on conflict do nothing
      `.execute(db);
    },
    continueCards: async (userId, now, limit) => {
      const rows = await sql<{
        item_id: string;
        moment_id: string;
        section_title: string;
        section_number: number;
        section_count: number;
        article_title: string;
        frameable: boolean;
      }>`
        with seen as (
          select moment_id, finished_at as at from user_moment_finished
          where user_id = ${userId}
          union all
          select moment_id, opened_at from user_moment_opened
          where user_id = ${userId}
        ),
        per_item as (
          select m.content_item_id as item_id, max(r.at) as last_at
          from seen r join moment m on m.id = r.moment_id
          group by m.content_item_id
          having max(r.at) > ${now}::timestamptz - interval '30 days'
        )
        select p.item_id, nx.id as moment_id, nx.title as section_title,
               nx.ordinal + 1 as section_number,
               (select count(*) from moment where content_item_id = p.item_id)::integer
                 as section_count,
               c.title as article_title, coalesce(c.frameable, false) as frameable
        from per_item p
        join content_item c on c.id = p.item_id
        join source s on s.id = c.source_id
        cross join lateral (
          select m.id, m.title, m.ordinal from moment m
          where m.content_item_id = p.item_id
            and m.id not in (select moment_id from seen)
          order by m.ordinal limit 1
        ) nx
        -- The rights gate, as allowedMoments above (ING-2); a broken link has left
        -- the feed, and so its continue card (P1-W6-S03).
        where c.link_broken_at is null
          and s.moments_enabled
          and s.rights_profile in ('full_text_internal', 'full_text_display')
          -- Dismissed until the reader reads on (owner, 2026-10-26).
          and not exists (
            select 1 from continue_dismissal d
            where d.user_id = ${userId} and d.content_item_id = p.item_id
              and d.dismissed_at >= p.last_at
          )
          and not exists (
            select 1 from user_article_finished a
            where a.user_id = ${userId} and a.content_item_id = p.item_id
          )
        order by p.last_at desc, p.item_id
        limit ${limit}
      `.execute(db);
      return rows.rows.map((r) => ({
        itemId: r.item_id,
        momentId: r.moment_id,
        sectionTitle: r.section_title,
        sectionNumber: r.section_number,
        sectionCount: r.section_count,
        articleTitle: r.article_title,
        frameable: r.frameable,
      }));
    },
    dismissContinue: async (userId, itemId) => {
      await sql`
        insert into continue_dismissal (user_id, content_item_id)
        select ${userId}, id from content_item where id = ${itemId}
        on conflict (user_id, content_item_id) do update set dismissed_at = now()
      `.execute(db);
    },
    // The arm comes from the user's current stored feed: a recompute between showing
    // the card and the click may have changed it (hourly; accepted).
    countExploreOpen: async (userId, chip, itemId, momentId) => {
      await sql`
        with entry as (
          select explore_kind, explore_arm from user_feed_entry
          where user_id = ${userId} and chip = ${chip}::break_length
            and content_item_id = ${itemId}
            and moment_id is not distinct from ${momentId}::bigint
            and explore_kind is not null
        ),
        opened as (
          insert into user_explore_open (user_id, content_item_id, kind, arm)
          select ${userId}, ${itemId}, explore_kind, explore_arm from entry
          on conflict do nothing
          returning kind, arm
        )
        insert into explore_arm_outcome (kind, arm, shown, finished)
        select kind, arm, 1, 0 from opened
        on conflict (kind, arm)
        do update set shown = explore_arm_outcome.shown + 1
      `.execute(db);
    },
    countExploreFinish: async (userId, itemId) => {
      await sql`
        with counted as (
          update user_explore_open set finished_counted = true
          where user_id = ${userId} and content_item_id = ${itemId}
            and not finished_counted
          returning kind, arm
        )
        update explore_arm_outcome o set finished = o.finished + 1
        from counted c where o.kind = c.kind and o.arm = c.arm
      `.execute(db);
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
