-- migrate:up
-- Why-this-matters notes (§5E, REC-5, Q-P1-18, P1-W4-S06): built from a card's top
-- ranking signal, cached per item, signal and level (plus the topic or chip the words
-- name), and kept apart from any source text (AI-3). A note cites its item; the card
-- links the moment. `model` is set once the notes model polished it: only then is the
-- note labelled AI in the UI (owner, 2026-10-26).
create table feed_note (
  id bigint generated always as identity primary key,
  content_item_id bigint not null references content_item (id) on delete cascade,
  signal text not null,
  level difficulty not null,
  variant text not null,
  text text not null check (length(text) between 1 and 300),
  model text,
  created_at timestamptz not null default now(),
  polished_at timestamptz,
  unique (content_item_id, signal, level, variant)
);

alter table user_feed_entry
  add column note_id bigint references feed_note (id) on delete set null;
alter table starter_feed_entry
  add column note_id bigint references feed_note (id) on delete set null;

drop view starter_feed_visible;
drop view user_feed_visible;

-- As before, plus the note (no source text: a note is built from the title, the
-- source's name and the user's choices).
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
where fe.moment_id is null
  or (s.moments_enabled
      and s.rights_profile in ('full_text_internal', 'full_text_display'));

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
where fe.moment_id is null
  or (s.moments_enabled
      and s.rights_profile in ('full_text_internal', 'full_text_display'));

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
  s.name as source_name
from user_feed_entry fe
join content_item ci on ci.id = fe.content_item_id
join source s on s.id = ci.source_id
left join moment m on m.id = fe.moment_id
where fe.moment_id is null
  or (s.moments_enabled
      and s.rights_profile in ('full_text_internal', 'full_text_display'));

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
  s.name as source_name
from starter_feed_entry fe
join content_item ci on ci.id = fe.content_item_id
join source s on s.id = ci.source_id
left join moment m on m.id = fe.moment_id
where fe.moment_id is null
  or (s.moments_enabled
      and s.rights_profile in ('full_text_internal', 'full_text_display'));
alter table starter_feed_entry drop column note_id;
alter table user_feed_entry drop column note_id;
drop table feed_note;
