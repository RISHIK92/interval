-- migrate:up
-- Project-aware notes (§5B, AI-1, AI-3, OPS-4, P2-W12-S05): one line per user, item and
-- repository set, written by the notes model from the repositories' names, descriptions
-- and matching technologies only (never code). AI output, kept apart from source text
-- and from the shared feed notes; it goes with the GitHub connection.
create table project_note (
  id bigint generated always as identity primary key,
  user_id text not null references github_account (user_id) on delete cascade,
  content_item_id bigint not null references content_item (id) on delete cascade,
  -- Sorted full names: with the user and item, the cache key.
  repositories text[] not null check (cardinality(repositories) between 1 and 20),
  technologies text[] not null check (cardinality(technologies) >= 1),
  -- Null: the model's reply was refused; not asked again for this repository set.
  text text check (char_length(text) between 1 and 300),
  model text not null,
  created_at timestamptz not null default now(),
  unique (user_id, content_item_id, repositories)
);

alter type ai_feature add value if not exists 'project_notes';

create or replace view user_feed_visible as
select
  fe.user_id,
  fe.chip,
  fe.rank,
  case when fe.moment_id is null then 'article' else 'moment' end as kind,
  fe.content_item_id,
  m.id as moment_id,
  m.title as section_title,
  m.ordinal + 1 as section_number,
  -- All of the item's moments, not only those in the feed: "Section 2 of 4" stays true.
  (select count(*) from moment m2 where m2.content_item_id = m.content_item_id)::integer
    as section_count,
  coalesce(m.estimated_minutes, item_minutes(ci.id)) as estimated_minutes,
  coalesce(m.link, ci.canonical_url) as link,
  ci.title as article_title,
  ci.author,
  s.name as source_name,
  n.text as note_text,
  n.model is not null as note_ai,
  -- ADR-0018: whether the in-app reader may frame the page (null: not known yet).
  ci.frameable,
  -- ADR-0019: the card's picture, from the source's first topic Interval knows.
  (select t.v::topic from unnest(s.topics) with ordinality t(v, i)
   where t.v = any(enum_range(null::topic)::text[])
   order by t.i limit 1) as source_topic,
  -- P2-W12-S05: the user's own line about their project, never another user's.
  pn.text as project_note_text,
  pn.repositories as project_note_repositories
from user_feed_entry fe
join content_item ci on ci.id = fe.content_item_id
join source s on s.id = ci.source_id
left join moment m on m.id = fe.moment_id
left join feed_note n on n.id = fe.note_id
left join lateral (
  select p.text, p.repositories from project_note p
  where p.user_id = fe.user_id and p.content_item_id = fe.content_item_id
    and p.text is not null
    -- Only while every repository it names is still one the user shares.
    and p.repositories <@ array(
      select r.full_name from github_repository r where r.user_id = fe.user_id)
  order by p.created_at desc limit 1
) pn on true
-- A broken link (404/410 at the weekly check, P1-W6-S03) leaves every feed at once.
where ci.link_broken_at is null
  and (fe.moment_id is null
       or (s.moments_enabled
           and s.rights_profile in ('full_text_internal', 'full_text_display')));

-- migrate:down
drop view user_feed_visible;
create view user_feed_visible as
select
  fe.user_id,
  fe.chip,
  fe.rank,
  case when fe.moment_id is null then 'article' else 'moment' end as kind,
  fe.content_item_id,
  m.id as moment_id,
  m.title as section_title,
  m.ordinal + 1 as section_number,
  -- All of the item's moments, not only those in the feed: "Section 2 of 4" stays true.
  (select count(*) from moment m2 where m2.content_item_id = m.content_item_id)::integer
    as section_count,
  coalesce(m.estimated_minutes, item_minutes(ci.id)) as estimated_minutes,
  coalesce(m.link, ci.canonical_url) as link,
  ci.title as article_title,
  ci.author,
  s.name as source_name,
  n.text as note_text,
  n.model is not null as note_ai,
  -- ADR-0018: whether the in-app reader may frame the page (null: not known yet).
  ci.frameable,
  -- ADR-0019: the card's picture, from the source's first topic Interval knows.
  (select t.v::topic from unnest(s.topics) with ordinality t(v, i)
   where t.v = any(enum_range(null::topic)::text[])
   order by t.i limit 1) as source_topic
from user_feed_entry fe
join content_item ci on ci.id = fe.content_item_id
join source s on s.id = ci.source_id
left join moment m on m.id = fe.moment_id
left join feed_note n on n.id = fe.note_id
-- A broken link (404/410 at the weekly check, P1-W6-S03) leaves every feed at once.
where ci.link_broken_at is null
  and (fe.moment_id is null
       or (s.moments_enabled
           and s.rights_profile in ('full_text_internal', 'full_text_display')));
drop table project_note;
-- ai_feature keeps 'project_notes': Postgres can't drop an enum value.
