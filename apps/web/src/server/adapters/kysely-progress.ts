import type { DB } from "@interval/db";
import { type Kysely, type RawBuilder, sql } from "kysely";
import type { Progress } from "../ports";

// Reading as weak evidence of mastery (PER-2, Q-P2-02): each new finish moves a concept
// a tenth of the way to 1, never past 0.3 from reading alone, and never lowers or
// demotes one a quiz has raised further; reading's state is explored (Q-P2-03).
const READING_WEIGHT = 0.1;
const READING_CAP = 0.3;

// Credits each concept `taught` selects (one `id` column). Part of the finish's own
// statement, reading its `added` rows, so a repeat finish credits nothing and a finish
// is never kept without its credit.
function credit(
  userId: string,
  taught: RawBuilder<unknown>,
): RawBuilder<unknown> {
  return sql`
    insert into concept_mastery
      (user_id, concept_id, probability, state, evidence_count)
    -- A first finish moves p from 0 by the weight; in id order, so two finishes at
    -- once lock the rows they share in the same order.
    select ${userId}, id, ${READING_WEIGHT}::double precision, 'explored', 1
    from (${taught}) taught
    order by id
    on conflict (user_id, concept_id) do update set
      probability = case
        when concept_mastery.probability >= ${READING_CAP}::double precision
          then concept_mastery.probability
        else least(
          ${READING_CAP}::double precision,
          concept_mastery.probability
            + ${READING_WEIGHT}::double precision * (1 - concept_mastery.probability)
        )
      end,
      evidence_count = concept_mastery.evidence_count + 1,
      updated_at = now()
  `;
}

// The live concepts a finished moment or article teaches; an admin's correction
// replaces the model's tags (P1-W3-S05), for a moment by its heading. A retired concept
// isn't credited: its tags wait for the migration script (Q-P1-04). A moment its source
// no longer allows isn't read (ING-2), as allowedMoments below.
const MOMENT_CONCEPTS = sql`
  select c.id from added a
  join moment m on m.id = a.moment_id
  join content_item ci on ci.id = m.content_item_id
  join source s on s.id = ci.source_id
   and s.moments_enabled
   and s.rights_profile in ('full_text_internal', 'full_text_display')
  join concept c on c.retired_at is null and c.slug = any(coalesce(
    (select o.concepts from tag_override o
     where o.content_item_id = m.content_item_id
       and o.heading = m.title and m.link_type <> 'page_top'),
    array(select c2.slug from moment_concept mc
          join concept c2 on c2.id = mc.concept_id where mc.moment_id = m.id)
  ))
`;
const ARTICLE_CONCEPTS = sql`
  select c.id from added a
  join concept c on c.retired_at is null and c.slug = any(coalesce(
    (select o.concepts from tag_override o
     where o.content_item_id = a.content_item_id and o.heading = ''),
    array(select c2.slug from item_concept ic
          join concept c2 on c2.id = ic.concept_id
          where ic.content_item_id = a.content_item_id)
  ))
`;

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
      const added = await sql<{ moment_id: string }>`
        with added as (
          insert into user_moment_finished (user_id, moment_id, method)
          select ${userId}, id, ${method}::finish_method from moment
          where id = ${momentId} and content_item_id = ${itemId}
          on conflict do nothing
          returning moment_id
        ), credited as (${credit(userId, MOMENT_CONCEPTS)})
        select moment_id from added
      `.execute(db);
      return added.rows.length > 0;
    },
    finishArticle: async (userId, itemId, method) => {
      const added = await sql<{ content_item_id: string }>`
        with added as (
          insert into user_article_finished (user_id, content_item_id, method)
          select ${userId}, id, ${method}::finish_method from content_item
          where id = ${itemId}
          on conflict do nothing
          returning content_item_id
        ), credited as (${credit(userId, ARTICLE_CONCEPTS)})
        select content_item_id from added
      `.execute(db);
      return added.rows.length > 0;
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
        with added as (
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
        ), credited as (${credit(userId, ARTICLE_CONCEPTS)})
        select content_item_id from added
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
        .select(["m.id", "m.title", "c.frameable"])
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
        : {
            momentId: next.id,
            title: next.title,
            frameable: next.frameable === true,
          };
    },
  };
}
