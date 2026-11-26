import type { DB, Topic } from "@interval/db";
import { type Kysely, sql } from "kysely";
import {
  type Explore,
  type ExploreResult,
  isTopic,
  type SavedMostItem,
  type SpaceStats,
  TOPICS,
} from "../ports";

// ADR-0046: Explore, in Postgres (ADR-0011). Titles, names and the user's own notes
// only: never content_item_private_text (ING-2).

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
// Q-WD-03 (recommended, pending the owner): an item shows only once this many people
// saved it in the last 7 days.
const MIN_SAVERS = 5;
const SAVED_MOST_LIMIT = 5;

// An item the page may show this user: its link works, its source is on and not one
// the user hid, and it isn't a duplicate. `ci` and `s` must be in scope.
const visibleTo = (userId: string) => sql`
  ci.link_broken_at is null and s.active and ci.duplicate_of is null
  and not exists (select 1 from user_hidden_source h
                  where h.user_id = ${userId} and h.source_id = s.id)`;

// A moment the feed itself would show: its source makes moments (ING-2).
const momentsShown = sql`s.moments_enabled
  and s.rights_profile in ('full_text_internal', 'full_text_display')`;

// An item's topics: its source's, and its concepts'. `ci` and `s` must be in scope.
const inTopics = (topics: readonly string[]) => sql`(
  s.topics && ${topics}::text[]
  or exists (select 1 from item_concept ic join concept c on c.id = ic.concept_id
             where ic.content_item_id = ci.id and c.topic = any(${topics}::text[])))`;

// The card's picture: the source's first topic Interval knows (as the feed views).
const sourceTopic = sql<string | null>`(select t.v from unnest(s.topics)
  with ordinality t(v, i) where t.v = any(enum_range(null::topic)::text[])
  order by t.i limit 1)`;

const topicOf = (value: string | null): Topic | null =>
  value !== null && isTopic(value) ? value : null;

export function kyselyExplore(db: Kysely<DB>): Explore {
  return {
    search: async (userId, query, limit) => {
      // Each kind of match scores; an item's score is their sum. Source, concept and
      // technology matches weigh less than the item's own words.
      const { rows } = await sql<{
        item_id: string;
        moment_id: string | null;
        title: string | null;
        article_title: string;
        source_name: string;
        author: string | null;
        minutes: number | null;
        saved: boolean;
        note: string | null;
      }>`
        with q as (select websearch_to_tsquery('english', ${query}) as q),
        visible as (
          select ci.id, ci.search_vector, s.name,
                 (${momentsShown}) as shows_moments
          from content_item ci join source s on s.id = ci.source_id
          where ${visibleTo(userId)}
        ),
        live_concept as (
          select c.id from concept c, q
          where c.retired_at is null and c.merged_into is null
            and to_tsvector('english', c.name || ' ' || array_to_string(c.aliases, ' '))
                @@ q.q
        ),
        hits as (
          select v.id as item_id, null::bigint as moment_id,
                 ts_rank(v.search_vector, q.q) as score
          from visible v, q where v.search_vector @@ q.q
          union all
          select v.id, null, 0.5 * ts_rank(to_tsvector('english', v.name), q.q)
          from visible v, q where to_tsvector('english', v.name) @@ q.q
          union all
          select m.content_item_id, m.id, ts_rank(m.search_vector, q.q)
          from moment m join visible v on v.id = m.content_item_id, q
          where v.shows_moments and m.search_vector @@ q.q
          union all
          select ic.content_item_id, null, 0.05
          from live_concept c join item_concept ic on ic.concept_id = c.id
          union all
          select m.content_item_id, m.id, 0.05
          from live_concept c
          join moment_concept mc on mc.concept_id = c.id
          join moment m on m.id = mc.moment_id
          join visible v on v.id = m.content_item_id
          where v.shows_moments
          union all
          select ic.content_item_id, null, 0.03
          from technology t, q, technology_concept tc, item_concept ic
          where t.retired_at is null and tc.technology_id = t.id
            and ic.concept_id = tc.concept_id
            and to_tsvector('english', t.name) @@ q.q
          union all
          select n.content_item_id, n.moment_id, ts_rank(n.search_vector, q.q)
          from user_note n, q
          where n.user_id = ${userId} and n.search_vector @@ q.q
        ),
        ranked as (
          select h.item_id, sum(h.score) as score,
                 (array_agg(h.moment_id order by h.score desc)
                    filter (where h.moment_id is not null))[1] as moment_id
          from hits h join visible v on v.id = h.item_id
          group by h.item_id
          order by sum(h.score) desc, h.item_id desc
          limit ${limit}
        )
        select r.item_id, m.id as moment_id, m.title, ci.title as article_title,
               s.name as source_name, ci.author,
               coalesce(m.estimated_minutes, item_minutes(ci.id)) as minutes,
               exists (select 1 from user_save us
                       where us.user_id = ${userId}
                         and us.content_item_id = ci.id) as saved,
               (select n.body from user_note n, q
                where n.user_id = ${userId} and n.content_item_id = ci.id
                  and n.search_vector @@ q.q
                order by n.updated_at desc limit 1) as note
        from ranked r
        join content_item ci on ci.id = r.item_id
        join source s on s.id = ci.source_id
        -- Only a section the feed would show; a note on another opens the article.
        left join moment m on m.id = r.moment_id and ${momentsShown}
        order by r.score desc, r.item_id desc
      `.execute(db);
      return rows.map((r): ExploreResult => ({
        itemId: r.item_id,
        momentId: r.moment_id,
        title: r.title ?? r.article_title,
        articleTitle: r.article_title,
        sourceName: r.source_name,
        author: r.author,
        minutes: r.minutes,
        saved: r.saved,
        note: r.note,
      }));
    },

    spaces: async (userId, now) => {
      const since = new Date(now.getTime() - WEEK_MS);
      const { rows } = await sql<{
        topic: string;
        learners: number;
        fresh: number;
      }>`
        select t.topic,
          (select count(*) from user_preferences p
           where t.topic = any(p.topics::text[]))::integer as learners,
          (select count(*) from content_item ci join source s on s.id = ci.source_id
           where ${visibleTo(userId)} and ci.fetched_at > ${since}
             and (t.topic = any(s.topics)
                  or exists (select 1 from item_concept ic
                             join concept c on c.id = ic.concept_id
                             where ic.content_item_id = ci.id and c.topic = t.topic))
             and not exists (select 1 from user_moment_opened o
                             join moment m on m.id = o.moment_id
                             where o.user_id = ${userId}
                               and m.content_item_id = ci.id))::integer as fresh
        from unnest(${[...TOPICS]}::text[]) as t(topic)
      `.execute(db);
      return rows
        .filter((r) => isTopic(r.topic))
        .map((r): SpaceStats => ({
          topic: r.topic as Topic, // filtered just above
          learners: r.learners,
          fresh: r.fresh,
        }));
    },

    gap: async (userId) => {
      const row = await sql<{
        concept_id: string;
        concept: string;
        topic: string;
        known: string[];
        item_id: string;
        moment_id: string;
        minutes: number;
      }>`
        with mastered as (
          select concept_id from concept_mastery
          where user_id = ${userId} and state = 'mastered'
        ),
        live as (
          select id, name, topic from concept
          where retired_at is null and merged_into is null
        ),
        candidate as (
          select c.id, c.name, c.topic,
                 array_agg(distinct k.name order by k.name) as known
          from live c
          join concept_edge e on e.from_id = c.id or e.to_id = c.id
          join live k on k.id = case when e.from_id = c.id then e.to_id else e.from_id end
          join mastered mk on mk.concept_id = k.id
          where c.id not in (select concept_id from mastered)
            and not exists (select 1 from explore_gap_dismissal d
                            where d.user_id = ${userId} and d.concept_id = c.id)
          group by c.id, c.name, c.topic
          having count(distinct k.id) >= 2
        ),
        shortest as (
          select distinct on (cand.id) cand.id, cand.name, cand.topic, cand.known,
                 m.id as moment_id, m.content_item_id, m.estimated_minutes
          from candidate cand
          join moment_concept mc on mc.concept_id = cand.id
          join moment m on m.id = mc.moment_id
          join content_item ci on ci.id = m.content_item_id
          join source s on s.id = ci.source_id
          where ${visibleTo(userId)} and ${momentsShown}
          order by cand.id, m.estimated_minutes, m.id
        )
        select id as concept_id, name as concept, topic, known,
               content_item_id as item_id, moment_id, estimated_minutes as minutes
        from shortest
        order by estimated_minutes, id
        limit 1
      `
        .execute(db)
        .then((r) => r.rows[0]);
      if (row === undefined) return null;
      const [first, second] = row.known;
      // The query keeps only concepts with two mastered neighbours.
      if (first === undefined || second === undefined) return null;
      return {
        conceptId: row.concept_id,
        concept: row.concept,
        topic: topicOf(row.topic),
        known: [first, second],
        itemId: row.item_id,
        momentId: row.moment_id,
        minutes: row.minutes,
      };
    },

    dismissGap: async (userId, conceptId) => {
      // A stale or forged id that names no concept stores nothing.
      await sql`
        insert into explore_gap_dismissal (user_id, concept_id)
        select ${userId}, c.id from concept c where c.id = ${conceptId}
        on conflict (user_id, concept_id) do nothing
      `.execute(db);
    },

    savedMost: async (userId, tab, followed, now) => {
      const since = new Date(now.getTime() - WEEK_MS);
      const { rows } = await sql<{
        item_id: string;
        title: string;
        source_name: string;
        minutes: number | null;
        topic: string | null;
      }>`
        select ci.id as item_id, ci.title, s.name as source_name,
               item_minutes(ci.id) as minutes, ${sourceTopic} as topic
        from user_save us
        join content_item ci on ci.id = us.content_item_id
        join source s on s.id = ci.source_id
        where us.saved_at > ${since} and ${visibleTo(userId)}
          -- Read (finished, whole or a section) or hidden by this user: left out.
          and not exists (select 1 from user_article_finished f
                          where f.user_id = ${userId} and f.content_item_id = ci.id)
          and not exists (select 1 from user_moment_finished f
                          join moment m on m.id = f.moment_id
                          where f.user_id = ${userId} and m.content_item_id = ci.id)
          and not exists (select 1 from item_feedback fb
                          where fb.user_id = ${userId} and fb.content_item_id = ci.id
                            and fb.kind = 'not_interested')
          and ${tab === "spaces" ? inTopics(followed) : sql`true`}
          and ${tab === "new" ? sql`ci.published_at > ${since}` : sql`true`}
        group by ci.id, s.id
        having count(distinct us.user_id) >= ${MIN_SAVERS}
        order by count(distinct us.user_id) desc, max(us.saved_at) desc, ci.id desc
        limit ${SAVED_MOST_LIMIT}
      `.execute(db);
      return rows.map((r): SavedMostItem => ({
        itemId: r.item_id,
        title: r.title,
        sourceName: r.source_name,
        minutes: r.minutes,
        topic: topicOf(r.topic),
      }));
    },
  };
}
