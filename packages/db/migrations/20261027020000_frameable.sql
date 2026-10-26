-- migrate:up
-- In-app reader (ADR-0018): whether an item's page allows Interval to frame it, read
-- from its own response headers at fetch and at the weekly link check. Null until
-- one of them has seen the page.
alter table content_item add column frameable boolean;

-- The views gain the column at the end; nothing else changes.
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
  ci.frameable
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
  ci.frameable
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
drop view starter_feed_visible;
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
  n.model is not null as note_ai
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
  n.model is not null as note_ai
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

alter table content_item drop column frameable;
