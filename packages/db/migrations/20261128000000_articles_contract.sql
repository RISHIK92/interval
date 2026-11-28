-- migrate:up
-- ADR-0058 stage C (contract): the moment schema and the break-length chips go. Every
-- stage B reader and writer works per article; what still hangs off a moment is folded
-- into its article first, so no model output (questions, tags, probabilities,
-- decisions, embeddings, explainer citations) and no person's data (notes, opens,
-- quiz attempts and answers, overrides) is lost. Only then is anything dropped.
--
-- It runs in one transaction and takes ACCESS EXCLUSIVE locks on the busiest tables
-- (question, the feeds, source, user_note): stop the web app and the workers while it
-- runs.

-- Stage A's fill triggers first: left in place, deleting moment embeddings below would
-- recompute the article vectors without them (to null).
drop trigger question_article on question;
drop trigger question_drafting_article on question_drafting;
drop trigger question_estimate_drafted_article on question_estimate_drafted;
drop trigger question_batch_item_article on question_batch_item;
drop trigger path_session_article on path_session;
drop trigger user_path_session_article on user_path_session;
drop trigger item_embedding_mean on item_embedding;
drop trigger moment_embedding_item_mean on moment_embedding;
drop trigger moment_item_embedding_mean on moment;
drop trigger user_moment_opened_article on user_moment_opened;
drop trigger user_moment_finished_article on user_moment_finished;
drop function fill_question_article();
drop function fill_question_batch_item_article();
drop function fill_content_item_from_moment();
drop function fill_item_embedding();
drop function item_embedding_follow_moment_embedding();
drop function item_embedding_follow_moment();
drop function refresh_item_embedding(bigint);
drop function open_article_of_moment();

-- 1. Tagging. What was read off the full text is marked (from_full_text), so the
-- rights purge deletes it as the moments' cascade did (ING-2); answers about the title
-- and summary alone stay. The moments' answers are kept as the article's own rows under
-- their own keys, never merged into the rows its own pass owns:
-- - 'moments:<model>:<ordinal>': each moment's answers as the model gave them, so the
--   rollup still applies its section rule to them (two sections at the moment cut, or
--   one at the strong cut), as it did when they were tagged;
-- - 'moments:<model>': stage A's per-article copy (refreshed for anything decided
--   since), which the rollup reads as one section only where no per-moment rows are
--   left (their moments re-segmented away before this);
-- - 'moments:tags': the moments' tags, at probability 1, for articles whose moments had
--   no answers behind them.
-- The worker's rollup reads them with the model's own (article_decisions in ports.py).
-- item_concept is left as it is: today's tags, rebuilt at the next tag pass.
alter table item_decision add column from_full_text boolean not null default false;
alter table item_tagging add column from_full_text boolean not null default false;

insert into item_decision (content_item_id, model, content_hash, difficulty, decided_at)
select m.content_item_id, 'moments:' || d.model || ':' || m.ordinal, d.content_hash,
       d.difficulty, d.decided_at
from moment_decision d
join moment m on m.id = d.moment_id
on conflict (content_item_id, model) do update
  set content_hash = excluded.content_hash, difficulty = excluded.difficulty,
      decided_at = excluded.decided_at;

insert into item_concept_probability (content_item_id, model, concept_id, probability)
select m.content_item_id, 'moments:' || p.model || ':' || m.ordinal, p.concept_id,
       p.probability
from moment_concept_probability p
join moment m on m.id = p.moment_id
on conflict (content_item_id, model, concept_id)
  do update set probability = excluded.probability;

insert into item_decision (content_item_id, model, content_hash, difficulty, decided_at)
select m.content_item_id, 'moments:' || d.model,
       md5(string_agg(d.content_hash, ',' order by m.ordinal)),
       percentile_cont(0.5) within group (order by d.difficulty),
       max(d.decided_at)
from moment_decision d
join moment m on m.id = d.moment_id
group by m.content_item_id, d.model
on conflict (content_item_id, model) do update
  set content_hash = excluded.content_hash, difficulty = excluded.difficulty,
      decided_at = excluded.decided_at;

insert into item_concept_probability (content_item_id, model, concept_id, probability)
select m.content_item_id, 'moments:' || p.model, p.concept_id, max(p.probability)
from moment_concept_probability p
join moment m on m.id = p.moment_id
group by m.content_item_id, p.model, p.concept_id
on conflict (content_item_id, model, concept_id)
  do update set probability = greatest(
    item_concept_probability.probability, excluded.probability
  );

-- The moments' tags where no answers stand behind them: their median level (0
-- beginner to 2 advanced, the decisions' scale), and each concept any of them had.
insert into item_decision (content_item_id, model, content_hash, difficulty, decided_at)
select m.content_item_id, 'moments:tags', 'moment-tags',
       percentile_disc(0.5) within group (
         order by array_position(enum_range(null::difficulty), t.difficulty) - 1
       ),
       now()
from moment_tagging t
join moment m on m.id = t.moment_id
where not exists (
  select 1 from moment_decision d
  join moment m2 on m2.id = d.moment_id
  where m2.content_item_id = m.content_item_id
)
group by m.content_item_id
on conflict (content_item_id, model) do nothing;

insert into item_concept_probability (content_item_id, model, concept_id, probability)
select distinct m.content_item_id, 'moments:tags', c.concept_id, 1.0::float8
from moment_concept c
join moment m on m.id = c.moment_id
join item_decision d
  on d.content_item_id = m.content_item_id and d.model = 'moments:tags'
on conflict (content_item_id, model, concept_id) do nothing;

update item_decision set from_full_text = true where model like 'moments:%';

-- Stage B asked about each article whole, its full text included where the source
-- allowed it. Its rows can't be told from the title pass by their content; this marks
-- the ones decided since stage B (2026-11-27) on an article with stored full text.
update item_decision d set from_full_text = true
where d.model not like 'moments:%' and d.decided_at >= '2026-11-27'
  and exists (
    select 1 from content_item_private_text pt where pt.content_item_id = d.content_item_id
  );

-- An article whose only tags were its moments' keeps them as its own: the moments'
-- median level and the concepts most of its moments had (the lower id on a tie), five
-- at most (MAX_CONCEPTS). prompt_version 1 predates every live prompt, so the next tag
-- pass asks about the article whole.
insert into item_tagging (content_item_id, difficulty, model, prompt_version)
select m.content_item_id,
       percentile_disc(0.5) within group (order by t.difficulty),
       'moments', 1
from moment_tagging t
join moment m on m.id = t.moment_id
where not exists (
  select 1 from item_tagging it where it.content_item_id = m.content_item_id
)
group by m.content_item_id;

insert into item_concept (content_item_id, concept_id)
select r.content_item_id, r.concept_id
from (
  select m.content_item_id, c.concept_id,
         row_number() over (
           partition by m.content_item_id
           order by count(*) desc, c.concept_id
         ) as n
  from moment_concept c
  join moment m on m.id = c.moment_id
  join item_tagging it on it.content_item_id = m.content_item_id
  where it.model = 'moments'
  group by m.content_item_id, c.concept_id
) r
where r.n <= 5
on conflict do nothing;

-- Tags read off the full text: rolled up over answers that were (today's tags over
-- the moments' answers), or written by a chat tagger (a model not 'decisions:'), which
-- is given the full text whenever the article has it.
update item_tagging it set from_full_text = true
where exists (
    select 1 from item_decision d
    where d.content_item_id = it.content_item_id and d.from_full_text
  )
  or (it.model not like 'decisions:%' and exists (
    select 1 from content_item_private_text pt
    where pt.content_item_id = it.content_item_id
  ));

-- Neither earlier purge deleted tagging, so an article whose source was lowered below
-- full text before now (its text gone, so nothing above can mark it) may still hold
-- tagging read off its full text. It goes now, as the purge below would have taken
-- it: the moments' and the marked answers, stage B's whole-article answers, and tags
-- from a chat tagger or marked. This may take some that read only the title; the next
-- tag pass asks again. Articles on full-text sources are not touched.
do $$
declare
  decisions bigint;
  tags bigint;
begin
  delete from item_decision d
  using content_item ci, source s
  where d.content_item_id = ci.id and s.id = ci.source_id
    and s.rights_profile not in ('full_text_internal', 'full_text_display')
    and (d.from_full_text or d.model like 'moments:%' or d.decided_at >= '2026-11-27');
  get diagnostics decisions = row_count;
  delete from item_tagging t
  using content_item ci, source s
  where t.content_item_id = ci.id and s.id = ci.source_id
    and s.rights_profile not in ('full_text_internal', 'full_text_display')
    and (t.from_full_text or t.model not like 'decisions:%');
  get diagnostics tags = row_count;
  raise notice 'ADR-0058 stage C: % decisions and % tag rows of lowered sources purged',
    decisions, tags;
end;
$$;

-- Embeddings: every article whose moments were embedded has its vector, the mean of
-- theirs (stage A filled them; this covers any it couldn't). A vector the article has
-- of its own is kept.
insert into item_embedding (content_item_id, model, embedding, embedded_at)
select m.content_item_id, e.model, avg(e.embedding), max(e.embedded_at)
from moment_embedding e
join moment m on m.id = e.moment_id
group by m.content_item_id, e.model
on conflict (content_item_id, model) do update
  set embedding = excluded.embedding
  where item_embedding.embedding is null;

-- 2. Explainer citations: stage A's update again, for explainers written since, so each
-- names its article; then the moment ids go (AI-3: the quote still cites its passage).
-- A citation whose moment was gone before stage A keeps its quote and names nothing:
-- it can't be linked, and it counts as missing, as it has since stage A (citedArticles
-- in the web; the approval rule counts linked articles only).
update concept_explainer x
set citations = (
  select jsonb_agg(
    case
      when jsonb_typeof(c.e) <> 'object' then c.e
      when c.e ? 'content_item_id' or m.id is null then c.e - 'moment_id'
      else (c.e || jsonb_build_object('content_item_id', m.content_item_id)) - 'moment_id'
    end
    order by c.o
  )
  from jsonb_array_elements(x.citations) with ordinality c(e, o)
  left join moment m on m.id = case
    when c.e ->> 'moment_id' ~ '^[0-9]+$' then (c.e ->> 'moment_id')::bigint
  end
)
where x.citations <> '[]'::jsonb;

-- Ask answers' citations already name their article (item_id); a moment id written
-- before ADR-0058 goes too.
update ask_answer
set citations = (
  select jsonb_agg(
    case when jsonb_typeof(c.e) = 'object' then c.e - 'moment_id' else c.e end
    order by c.o
  )
  from jsonb_array_elements(citations) with ordinality c(e, o)
)
where jsonb_typeof(citations) = 'array' and exists (
  select 1 from jsonb_array_elements(citations) e
  where jsonb_typeof(e) = 'object' and e ? 'moment_id'
);

-- 3. tag_override: an article with no whole-article ('') row gets one from its section
-- rows: every concept any of them names, the most recently edited row's first, then
-- in each row's order, up to the check's five; the level, editor and time of the most
-- recently edited. Where the article has its own row, that row wins and the section
-- rows go.
insert into tag_override (content_item_id, heading, difficulty, concepts, updated_by,
  updated_at)
select latest.content_item_id, '', latest.difficulty,
       coalesce((
         select array_agg(u.concept order by u.first_seen)
         from (
           select x.concept, min(r.rank * 1000 + x.pos) as first_seen
           from (
             select o2.concepts,
                    row_number() over (order by o2.updated_at desc, o2.heading) as rank
             from tag_override o2
             where o2.content_item_id = latest.content_item_id and o2.heading <> ''
           ) r
           cross join lateral unnest(r.concepts) with ordinality x(concept, pos)
           group by x.concept
           order by first_seen
           limit 5
         ) u
       ), '{}'),
       latest.updated_by, latest.updated_at
from (
  select distinct on (o.content_item_id) o.*
  from tag_override o
  where o.heading <> ''
  order by o.content_item_id, o.updated_at desc, o.heading
) latest
on conflict (content_item_id, heading) do nothing;

delete from tag_override where heading <> '';
drop view user_avoided_concept;
alter table tag_override drop constraint tag_override_pkey;
alter table tag_override drop column heading;
alter table tag_override add primary key (content_item_id);

-- As before, reading the article's override with no heading to match.
create view user_avoided_concept as
select distinct f.user_id, c.slug, c.name
from item_feedback f
left join user_inferred_reset r on r.user_id = f.user_id
left join tag_override o on o.content_item_id = f.content_item_id
join concept c on (
  (o.content_item_id is not null and c.slug = any(o.concepts))
  or (o.content_item_id is null and c.id in (
    select concept_id from item_concept where content_item_id = f.content_item_id
  ))
)
where f.kind = 'not_interested'
  -- given_at is its transaction's start; a reset stamps clock_timestamp() in its own
  -- transaction, so feedback given after a reset compares later. One racing a reset
  -- may count as before it: it still hides, its concepts just don't count.
  and (r.reset_at is null or f.given_at > r.reset_at);

-- 4. Notes: a person's notes on an article's sections are joined into their note on the
-- article, after its own text, each under its section's title, in page order (a note
-- whose section was re-segmented away last, oldest first). A joined note may run past
-- the 2000 characters one can type, so the stored note has no upper bound: nothing is
-- cut, and the migration never stops on a long one. The writers keep 2000 for a new
-- note and allow an existing note's own length (NOTE_MAX, apps/web).
alter table user_note drop constraint user_note_body_check;
alter table user_note add constraint user_note_body_check
  check (char_length(body) >= 1);

create temporary table folded_note on commit drop as
select n.user_id, n.content_item_id,
       string_agg(
         coalesce(n.section_title, m.title, 'Section') || E'\n' || n.body,
         E'\n\n' order by m.ordinal nulls last, n.created_at, n.id
       ) as body,
       min(n.created_at) as created_at,
       max(n.updated_at) as updated_at
from user_note n
left join moment m on m.id = n.moment_id
where n.moment_id is not null or n.section_title is not null
group by n.user_id, n.content_item_id;

update user_note a
set body = a.body || E'\n\n' || f.body,
    updated_at = greatest(a.updated_at, f.updated_at)
from folded_note f
where a.user_id = f.user_id and a.content_item_id = f.content_item_id
  and a.moment_id is null and a.section_title is null;

insert into user_note (user_id, content_item_id, body, created_at, updated_at)
select f.user_id, f.content_item_id, f.body, f.created_at, f.updated_at
from folded_note f
where not exists (
  select 1 from user_note a
  where a.user_id = f.user_id and a.content_item_id = f.content_item_id
    and a.moment_id is null and a.section_title is null
);

delete from user_note where moment_id is not null or section_title is not null;
drop index user_note_one_per_section;
drop index user_note_one_per_article;
alter table user_note drop column moment_id, drop column section_title;
alter table user_note
  add constraint user_note_one_per_article unique (user_id, content_item_id);

-- Opens: every opened or finished moment is its article opened (stage A copied them and
-- its trigger kept them in step; this covers any missed). Completion stays
-- user_article_finished's (ADR-0058).
insert into user_article_opened (user_id, content_item_id, opened_at, last_opened_at)
select r.user_id, m.content_item_id, min(r.at), max(r.at)
from (
  select user_id, moment_id, opened_at as at from user_moment_opened
  union all
  select user_id, moment_id, finished_at from user_moment_finished
) r
join moment m on m.id = r.moment_id
group by r.user_id, m.content_item_id
on conflict (user_id, content_item_id) do update
  set opened_at = least(user_article_opened.opened_at, excluded.opened_at),
      last_opened_at = greatest(
        user_article_opened.last_opened_at, excluded.last_opened_at
      );

-- 5. Quiz attempts already name their article (content_item_id); the moment goes, and
-- with it its cascade, so no attempt or answer goes with the moments.
alter table quiz_attempt
  drop constraint quiz_attempt_match_shape,
  drop constraint quiz_attempt_shape,
  drop column moment_id;
alter table quiz_attempt
  add constraint quiz_attempt_match_shape check (
    match_id is null
    or (not review and not sprint and not estimation and daily_day is null
        and ends_at is not null and finished_at is not null
        and content_item_id is null and path_section_id is null
        and book_chapter_id is null and checkpoint_size is null
        and checkpoint_passed is null)
  ),
  add constraint quiz_attempt_shape check (
    match_id is not null
    or (daily_day is null and (
      (review and not sprint and content_item_id is null and ends_at is null
       and path_section_id is null and book_chapter_id is null
       and checkpoint_size is null and checkpoint_passed is null)
      or (not review and not sprint and content_item_id is not null
          and ends_at is not null and path_section_id is null
          and book_chapter_id is null and checkpoint_size is null
          and checkpoint_passed is null)
      or (not review and not sprint
          and num_nonnulls(path_section_id, book_chapter_id) = 1
          and checkpoint_size is not null and content_item_id is null
          and ends_at is not null)
      or (sprint and not review and ends_at is not null and content_item_id is null
          and path_section_id is null and book_chapter_id is null
          and checkpoint_size is null and checkpoint_passed is null)
    ))
    or (daily_day is not null and not review and not sprint and ends_at is not null
        and content_item_id is null and path_section_id is null
        and book_chapter_id is null and checkpoint_size is null
        and checkpoint_passed is null)
  );

-- 6. Questions. "Carried over" (drafted on the article's moments, so never redrafted
-- or retired per article) was "has a moment"; it is now a mark kept on the question,
-- and on the estimate's drafted hash. The slot is article_ordinal
-- (question_one_per_article_slot); ordinal, the slot within the moment, now matches it
-- for every article question, as stage B's writers already set it.
alter table question add column from_moments boolean not null default false;
update question set from_moments = true where moment_id is not null;
drop index question_one_per_slot;
update question set ordinal = article_ordinal
where content_item_id is not null and ordinal is distinct from article_ordinal;
alter table question drop constraint question_one_home;
alter table question drop column moment_id;
alter table question add constraint question_one_home
  check (num_nonnulls(content_item_id, book_chapter_id, source_url) = 1);

-- Retry state, one row an article: the article's own where it has one, else its
-- moments' latest.
delete from question_drafting d
where d.moment_id is not null
  and exists (
    select 1 from question_drafting a
    where a.content_item_id = d.content_item_id and a.moment_id is null
  );
delete from question_drafting d
using question_drafting later
where d.moment_id is not null and later.moment_id is not null
  and later.content_item_id = d.content_item_id
  and (later.retry_at, later.moment_id) > (d.retry_at, d.moment_id);
drop index question_drafting_moment;
drop index question_drafting_by_article;
alter table question_drafting
  drop constraint question_drafting_home,
  drop column moment_id,
  alter column content_item_id set not null,
  add primary key (content_item_id);

alter table question_estimate_drafted
  add column from_moments boolean not null default false;
update question_estimate_drafted a set from_moments = true
where a.moment_id is null
  and exists (
    select 1 from question_estimate_drafted d
    where d.content_item_id = a.content_item_id and d.moment_id is not null
  );
delete from question_estimate_drafted d
where d.moment_id is not null
  and exists (
    select 1 from question_estimate_drafted a
    where a.content_item_id = d.content_item_id and a.moment_id is null
  );
delete from question_estimate_drafted d
using question_estimate_drafted first
where d.moment_id is not null and first.moment_id is not null
  and first.content_item_id = d.content_item_id and first.moment_id < d.moment_id;
update question_estimate_drafted set from_moments = true where moment_id is not null;
drop index question_estimate_drafted_moment;
drop index question_estimate_drafted_by_article;
alter table question_estimate_drafted
  drop constraint question_estimate_drafted_home,
  drop column moment_id,
  alter column content_item_id set not null,
  add primary key (content_item_id);

-- A batch item drafts for an article or validates a question.
alter table question_batch_item
  drop constraint question_batch_item_check,
  drop column moment_id;
alter table question_batch_item add constraint question_batch_item_check
  check (question_id is not null or content_item_id is not null);

-- Path sessions are articles (stage B); user_path_articles() replaces this.
drop function user_path_sessions(text, bigint);
alter table path_session drop column moment_id;
alter table user_path_session drop column moment_id;

-- 7 and 8. The feeds: one ranked list of articles, without chips. The stored lists are
-- a cache (CACHE-1), rebuilt by the next recompute; until then each keeps the chip
-- stage B writes (its FEED_CHIP), an article once, at its best rank.
drop view user_feed_visible;
drop view starter_feed_visible;

delete from user_feed_entry where chip <> '3-8';
delete from user_feed_entry e
using user_feed_entry better
where better.user_id = e.user_id and better.content_item_id = e.content_item_id
  and better.rank < e.rank;
drop index user_feed_entry_article;
drop index user_feed_entry_moment;
alter table user_feed_entry
  drop constraint user_feed_entry_pkey,
  drop column moment_id,
  drop column chip,
  add primary key (user_id, rank),
  add constraint user_feed_entry_article unique (user_id, content_item_id);

delete from starter_feed_entry where chip <> '3-8';
delete from starter_feed_entry e
using starter_feed_entry better
where better.topic = e.topic and better.level = e.level
  and better.content_item_id = e.content_item_id and better.rank < e.rank;
drop index starter_feed_entry_article;
drop index starter_feed_entry_moment;
alter table starter_feed_entry
  drop constraint starter_feed_entry_pkey,
  drop column moment_id,
  drop column chip,
  add primary key (topic, level, rank),
  add constraint starter_feed_entry_article unique (topic, level, content_item_id);

-- What Home shows: entries whose link isn't broken (ING-6), as whole articles.
create view user_feed_visible as
select fe.user_id, fe.rank, fe.content_item_id,
       item_minutes(ci.id) as estimated_minutes,
       ci.canonical_url as link,
       ci.title as article_title, ci.author, s.name as source_name,
       n.text as note_text, n.model is not null as note_ai, ci.frameable,
       (select t.v::topic from unnest(s.topics) with ordinality t(v, i)
        where t.v = any(enum_range(null::topic)::text[])
        order by t.i limit 1) as source_topic,
       pn.text as project_note_text, pn.repositories as project_note_repositories,
       fe.reasons, fe.reason_kinds, fe.difficulty
from user_feed_entry fe
join content_item ci on ci.id = fe.content_item_id
join source s on s.id = ci.source_id
left join feed_note n on n.id = fe.note_id
left join lateral (
  select p.text, p.repositories from project_note p
  where p.user_id = fe.user_id and p.content_item_id = fe.content_item_id
    and p.text is not null
    and p.repositories <@ array(
      select r.full_name from github_repository r where r.user_id = fe.user_id
    )
  order by p.created_at desc
  limit 1
) pn on true
where ci.link_broken_at is null;

create view starter_feed_visible as
select fe.topic, fe.level, fe.rank, fe.content_item_id,
       item_minutes(ci.id) as estimated_minutes,
       ci.canonical_url as link,
       ci.title as article_title, ci.author, s.name as source_name,
       n.text as note_text, n.model is not null as note_ai, ci.frameable,
       (select t.v::topic from unnest(s.topics) with ordinality t(v, i)
        where t.v = any(enum_range(null::topic)::text[])
        order by t.i limit 1) as source_topic,
       fe.reasons, fe.reason_kinds, fe.difficulty
from starter_feed_entry fe
join content_item ci on ci.id = fe.content_item_id
join source s on s.id = ci.source_id
left join feed_note n on n.id = fe.note_id
where ci.link_broken_at is null;

-- The break length is no longer asked or ranked on.
alter table user_preferences drop column break_length;
drop type break_length;
delete from ranking_config where key = 'weight.time_fit';

-- ING-2 without moments: lowering a source below full text deletes what was derived
-- from its full text (text, sections, simhash, the article's vector, its questions and
-- their drafting state, the tagging answers and tags read off it); leaving the excerpt
-- profile clears the excerpt.
drop trigger source_purge_text_beyond_profile on source;
create or replace function purge_text_beyond_profile() returns trigger
language plpgsql as $$
begin
  if new.rights_profile not in ('full_text_internal', 'full_text_display') then
    delete from content_item_private_text pt
    using content_item ci
    where pt.content_item_id = ci.id and ci.source_id = new.id;
    delete from content_item_section cs
    using content_item ci
    where cs.content_item_id = ci.id and ci.source_id = new.id;
    update content_item set simhash = null
    where source_id = new.id and simhash is not null;
    delete from item_embedding ie
    using content_item ci
    where ie.content_item_id = ci.id and ci.source_id = new.id;
    delete from question q
    using content_item ci
    where q.content_item_id = ci.id and ci.source_id = new.id;
    delete from question_estimate_drafted d
    using content_item ci
    where d.content_item_id = ci.id and ci.source_id = new.id;
    delete from question_drafting d
    using content_item ci
    where d.content_item_id = ci.id and ci.source_id = new.id;
    -- The tagging answers asked about the full text (their probabilities go with
    -- them) and the tags rolled up from them (item_concept goes with item_tagging).
    -- The title pass's answers stay; with no tags left, the next tag pass of the
    -- article asks again about what its rights allow.
    delete from item_decision d
    using content_item ci
    where d.content_item_id = ci.id and ci.source_id = new.id and d.from_full_text;
    delete from item_tagging t
    using content_item ci
    where t.content_item_id = ci.id and ci.source_id = new.id and t.from_full_text;
  end if;
  if new.rights_profile <> 'excerpt' then
    update content_item set excerpt = null
    where source_id = new.id and excerpt is not null;
  end if;
  return new;
end;
$$;
create trigger source_purge_text_beyond_profile
  after update of rights_profile on source
  for each row when (old.rights_profile is distinct from new.rights_profile)
  execute function purge_text_beyond_profile();

alter table source
  drop constraint source_moments_switch,
  drop column moments_enabled,
  drop column moments_seeded,
  drop column moments_switched_off,
  drop column moments_switched_by,
  drop column moments_switched_at;

-- A daily challenge question's article must still allow full text (ING-2), and a
-- free-answer one's link must still work.
create or replace function daily_challenge_fit(
  p_day date, p_kind question_kind, p_except smallint
) returns bigint
language sql as $$
  select q.id
  from question q
  where q.status = 'live' and q.kind = p_kind
    and (
      (q.kind = 'estimate' and q.source_url is not null)
      or exists (
        select 1 from content_item ci
        join source s on s.id = ci.source_id
         and s.rights_profile in ('full_text_internal', 'full_text_display')
        where ci.id = q.content_item_id
          and (q.kind = 'choice' or ci.link_broken_at is null)
      )
    )
    and not exists (
      select 1 from daily_challenge_question d
      where d.question_id = q.id and d.day between p_day - 30 and p_day + 30
    )
    -- 5 different concepts: none the day's other questions test.
    and not exists (
      select 1 from daily_challenge_question d
      join question_concept other on other.question_id = d.question_id
      join question_concept mine on mine.concept_id = other.concept_id
      where d.day = p_day and d.position is distinct from p_except
        and mine.question_id = q.id
    )
  order by case when q.difficulty = 'intermediate' then 0
                when q.difficulty is null then 1 else 2 end,
           random()
  limit 1
$$;

-- Everything above is folded into the article; the moment schema goes.
drop table user_moment_opened;
drop table user_moment_finished;
drop table moment_embedding;
drop table moment_concept;
drop table moment_tagging;
drop table moment_concept_probability;
drop table moment_decision;
drop table moment_boundary_override;
drop table moment;
drop function enforce_moment_rights();
drop type moment_link_type;

-- migrate:down
do $$
begin
  raise exception 'ADR-0058 stage C cannot be undone: the moments and the chips are '
    'gone and their data is folded into the article. Restore the backup taken before '
    'migrating instead.';
end;
$$;
