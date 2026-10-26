-- migrate:up
-- Per-user precomputed feeds (CACHE-1, Q-P1-17, ADR-0008, P1-W4-S04). The worker ranks
-- (W4-S03) and writes; the web app only reads the *_visible views. The global feed of
-- Weeks 1-3 is retired: nothing reads it once each user has their own.
drop view feed_visible;
drop table feed_entry;

create table user_feed_entry (
  user_id text not null references app_user (id) on delete cascade,
  moment_id bigint not null references moment (id) on delete cascade,
  rank integer not null,
  -- The rule that counted most, for the why-this-matters note (W4-S06, REC-5).
  top_signal text not null,
  primary key (user_id, moment_id)
);
create index user_feed_entry_rank on user_feed_entry (user_id, rank);

-- When the feed was last computed. Its presence means "computed" even when the feed is
-- empty, so a first visit (ADR-0008) can tell "not yet" from "nothing to show".
create table user_feed_state (
  user_id text primary key references app_user (id) on delete cascade,
  computed_at timestamptz not null
);

-- A new guest's feed while their own is computed (ADR-0008): one per (topic, level).
create table starter_feed_entry (
  topic text not null,
  level difficulty not null,
  moment_id bigint not null references moment (id) on delete cascade,
  rank integer not null,
  primary key (topic, level, moment_id)
);

-- What a card may show: section title, position, minutes, link and attribution. No
-- summary, excerpt or private text is reachable from here (§3.2, ING-2). The source
-- filter repeats the moment gate so a stale entry never becomes a card.
create view user_feed_visible as
select
  fe.user_id,
  fe.rank,
  m.id as moment_id,
  m.title as section_title,
  m.ordinal + 1 as section_number,
  -- All of the item's moments, not only those in the feed: "Section 2 of 4" stays true.
  (select count(*) from moment m2 where m2.content_item_id = m.content_item_id)::integer
    as section_count,
  m.estimated_minutes,
  m.link,
  ci.title as article_title,
  ci.author,
  s.name as source_name
from user_feed_entry fe
join moment m on m.id = fe.moment_id
join content_item ci on ci.id = m.content_item_id
join source s on s.id = ci.source_id
where s.moments_enabled
  and s.rights_profile in ('full_text_internal', 'full_text_display');

create view starter_feed_visible as
select
  fe.topic,
  fe.level,
  fe.rank,
  m.id as moment_id,
  m.title as section_title,
  m.ordinal + 1 as section_number,
  (select count(*) from moment m2 where m2.content_item_id = m.content_item_id)::integer
    as section_count,
  m.estimated_minutes,
  m.link,
  ci.title as article_title,
  ci.author,
  s.name as source_name
from starter_feed_entry fe
join moment m on m.id = fe.moment_id
join content_item ci on ci.id = m.content_item_id
join source s on s.id = ci.source_id
where s.moments_enabled
  and s.rights_profile in ('full_text_internal', 'full_text_display');

-- migrate:down
drop view starter_feed_visible;
drop view user_feed_visible;
drop table starter_feed_entry;
drop table user_feed_state;
drop table user_feed_entry;
create table feed_entry (
  moment_id bigint primary key references moment (id) on delete cascade,
  rank integer not null,
  computed_at timestamptz not null default now()
);
create view feed_visible as
select
  fe.rank,
  m.id as moment_id,
  m.title as section_title,
  m.ordinal + 1 as section_number,
  (select count(*) from moment m2 where m2.content_item_id = m.content_item_id)::integer
    as section_count,
  m.estimated_minutes,
  m.link,
  ci.title as article_title,
  ci.author,
  s.name as source_name
from feed_entry fe
join moment m on m.id = fe.moment_id
join content_item ci on ci.id = m.content_item_id
join source s on s.id = ci.source_id
where s.moments_enabled
  and s.rights_profile in ('full_text_internal', 'full_text_display');
