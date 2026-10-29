-- migrate:up
-- "Shown for" reasons (ADR-0026): the worker renders why the ranking showed each entry
-- from its own breakdown, at recompute; private to the user on their feed (it may name
-- their repositories), topic and level only on a starter feed.
-- reason_kinds: which reasons the line states, in its order, for "a reason is wrong".
alter table user_feed_entry
  add column reasons text check (char_length(reasons) between 1 and 600),
  add column reason_kinds text[] not null default '{}'
    check (reason_kinds <@ array['topic_match', 'goal_match', 'project_match', 'level_fit', 'time_fit', 'quality', 'freshness', 'explore']::text[]);
alter table starter_feed_entry
  add column reasons text check (char_length(reasons) between 1 and 600),
  add column reason_kinds text[] not null default '{}'
    check (reason_kinds <@ array['topic_match', 'goal_match', 'project_match', 'level_fit', 'time_fit', 'quality', 'freshness', 'explore']::text[]);

-- A user saying one of a card's reasons is wrong (a tag, a mapping): once per user,
-- item and reason; /admin/items lists reported items first.
create table reason_report (
  user_id text not null references app_user (id) on delete cascade,
  content_item_id bigint not null references content_item (id) on delete cascade,
  reason text not null check (reason in ('topic_match', 'goal_match', 'project_match',
    'level_fit', 'time_fit', 'quality', 'freshness', 'explore')),
  reported_at timestamptz not null default now(),
  primary key (user_id, content_item_id, reason)
);
create index reason_report_item on reason_report (content_item_id);

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
  pn.repositories as project_note_repositories,
  -- ADR-0026: why the ranking showed it, in words, every reason that counted.
  fe.reasons,
  fe.reason_kinds
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

create or replace view starter_feed_visible as
select
  fe.topic,
  fe.level,
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
  fe.reasons,
  fe.reason_kinds
from starter_feed_entry fe
join content_item ci on ci.id = fe.content_item_id
join source s on s.id = ci.source_id
left join moment m on m.id = fe.moment_id
left join feed_note n on n.id = fe.note_id
-- A broken link (404/410 at the weekly check, P1-W6-S03) leaves every feed at once.
where ci.link_broken_at is null
  and (fe.moment_id is null
       or (s.moments_enabled
           and s.rights_profile in ('full_text_internal', 'full_text_display')));

-- migrate:down
drop table reason_report;
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
drop view starter_feed_visible;
create view starter_feed_visible as
select
  fe.topic,
  fe.level,
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
from starter_feed_entry fe
join content_item ci on ci.id = fe.content_item_id
join source s on s.id = ci.source_id
left join moment m on m.id = fe.moment_id
left join feed_note n on n.id = fe.note_id
-- A broken link (404/410 at the weekly check, P1-W6-S03) leaves every feed at once.
where ci.link_broken_at is null
  and (fe.moment_id is null
       or (s.moments_enabled
           and s.rights_profile in ('full_text_internal', 'full_text_display')));
alter table starter_feed_entry drop column reasons, drop column reason_kinds;
alter table user_feed_entry drop column reasons, drop column reason_kinds;
