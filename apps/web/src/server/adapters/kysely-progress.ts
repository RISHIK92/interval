import type { DB } from "@interval/db";
import { type Kysely, type RawBuilder, sql } from "kysely";
import { type ConceptsByTopic, type Progress, TOPICS } from "../ports";

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

// The live concepts a completed article teaches; an admin's whole-article correction
// replaces the model's tags (P1-W3-S05). A retired concept isn't credited: its tags
// wait for the migration script (Q-P1-04). ADR-0058: no per-section credit any more.
const ARTICLE_CONCEPTS = sql`
  select c.id from added a
  join concept c on c.retired_at is null and c.slug = any(coalesce(
    (select o.concepts from tag_override o
     where o.content_item_id = a.content_item_id),
    array(select c2.slug from item_concept ic
          join concept c2 on c2.id = ic.concept_id
          where ic.content_item_id = a.content_item_id)
  ))
`;

// Inserts select from the item, so an id that names nothing writes nothing; `on
// conflict do nothing` keeps the first finish.
export function kyselyProgress(db: Kysely<DB>): Progress {
  return {
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
    describe: async (itemId) => {
      const item = await db
        .selectFrom("content_item")
        .select("title")
        .where("id", "=", itemId)
        .executeTakeFirst();
      return item === undefined ? null : { articleTitle: item.title };
    },
    // ADR-0058: the first open is kept and the last moves on (last_opened_at orders
    // Continue reading and starts its 30 days), and an open after a dismissal brings
    // the card back, as reading on did (owner, 2026-10-26).
    recordOpen: async (userId, itemId) => {
      await sql`
        with opened as (
          insert into user_article_opened (user_id, content_item_id)
          select ${userId}, id from content_item where id = ${itemId}
          on conflict (user_id, content_item_id)
            do update set last_opened_at = now()
        )
        delete from continue_dismissal
        where user_id = ${userId} and content_item_id = ${itemId}
      `.execute(db);
    },
    continueCards: async (userId, now, limit) => {
      const rows = await sql<{
        item_id: string;
        article_title: string;
        source_name: string;
        estimated_minutes: number | null;
        frameable: boolean;
      }>`
        select c.id as item_id, c.title as article_title, s.name as source_name,
               item_minutes(c.id) as estimated_minutes,
               coalesce(c.frameable, false) as frameable
        from user_article_opened o
        join content_item c on c.id = o.content_item_id
        join source s on s.id = c.source_id
        -- ADR-0058: an article's own link is allowed under every rights profile, so
        -- no rights gate here; a broken link has left the feed, and so its continue
        -- card (P1-W6-S03).
        where o.user_id = ${userId}
          and o.last_opened_at > ${now}::timestamptz - interval '30 days'
          and c.link_broken_at is null
          and not exists (
            select 1 from continue_dismissal d
            where d.user_id = ${userId} and d.content_item_id = c.id
          )
          and not exists (
            select 1 from user_article_finished a
            where a.user_id = ${userId} and a.content_item_id = c.id
          )
        order by o.last_opened_at desc, c.id
        limit ${limit}
      `.execute(db);
      return rows.rows.map((r) => ({
        itemId: r.item_id,
        articleTitle: r.article_title,
        sourceName: r.source_name,
        estimatedMinutes: r.estimated_minutes,
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
    countExploreOpen: async (userId, itemId) => {
      await sql`
        with entry as (
          select explore_kind, explore_arm from user_feed_entry
          where user_id = ${userId} and content_item_id = ${itemId}
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
    concepts: async (userId) => {
      const rows = await db
        .selectFrom("concept_mastery as m")
        .innerJoin("concept as c", "c.id", "m.concept_id")
        .leftJoin("concept_review as r", (join) =>
          join
            .onRef("r.concept_id", "=", "m.concept_id")
            .onRef("r.user_id", "=", "m.user_id"),
        )
        .select([
          "c.slug",
          "c.name",
          "c.topic",
          "m.state",
          sql<boolean>`coalesce(r.due <= now(), false)`.as("due"),
        ])
        .where("m.user_id", "=", userId)
        // As crediting does (S01); see Q-P2-06.
        .where("c.retired_at", "is", null)
        .orderBy("m.updated_at", "desc")
        .orderBy("c.name")
        .execute();
      // Map keeps first-seen order: topics come as their newest concept did.
      const byTopic = new Map<ConceptsByTopic["topic"], ConceptsByTopic>();
      for (const row of rows) {
        // concept.topic is checked against these values in the database.
        const topic = TOPICS.find((t) => t === row.topic);
        if (topic === undefined) throw new Error(`unknown topic ${row.topic}`);
        let group = byTopic.get(topic);
        if (group === undefined) {
          group = { topic, concepts: [] };
          byTopic.set(topic, group);
        }
        group.concepts.push({
          slug: row.slug,
          name: row.name,
          state: row.state,
          due: row.due,
        });
      }
      return [...byTopic.values()];
    },
  };
}
