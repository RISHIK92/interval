-- migrate:up
-- One stored feed per time chip (Q-P1-16, §3.2, P1-W4-S05a): the chip picks what the feed
-- shows, and switching chips must stay one query. The precomputed rows are caches; the
-- next recompute (hourly, or after feedback) fills them again per chip.
drop view starter_feed_visible;
drop view user_feed_visible;
delete from user_feed_entry;
delete from user_feed_state;
delete from starter_feed_entry;

alter table user_feed_entry add column chip break_length not null;
alter table user_feed_entry drop constraint user_feed_entry_pkey;
alter table user_feed_entry add primary key (user_id, chip, moment_id);
drop index user_feed_entry_rank;
create index user_feed_entry_rank on user_feed_entry (user_id, chip, rank);

alter table starter_feed_entry add column chip break_length not null;
alter table starter_feed_entry drop constraint starter_feed_entry_pkey;
alter table starter_feed_entry add primary key (topic, level, chip, moment_id);

-- As before, plus the chip: card columns and the source gate only (§3.2, ING-2).
create view user_feed_visible as
select
  fe.user_id,
  fe.chip,
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
  fe.chip,
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
from starter_feed_entry fe
join moment m on m.id = fe.moment_id
join content_item ci on ci.id = m.content_item_id
join source s on s.id = ci.source_id
where s.moments_enabled
  and s.rights_profile in ('full_text_internal', 'full_text_display');

-- migrate:down
drop view starter_feed_visible;
drop view user_feed_visible;
delete from user_feed_entry;
delete from user_feed_state;
delete from starter_feed_entry;
alter table starter_feed_entry drop constraint starter_feed_entry_pkey;
alter table starter_feed_entry drop column chip;
alter table starter_feed_entry add primary key (topic, level, moment_id);
drop index user_feed_entry_rank;
alter table user_feed_entry drop constraint user_feed_entry_pkey;
alter table user_feed_entry drop column chip;
alter table user_feed_entry add primary key (user_id, moment_id);
create index user_feed_entry_rank on user_feed_entry (user_id, rank);
create view user_feed_visible as
select fe.user_id, fe.rank, m.id as moment_id, m.title as section_title,
  m.ordinal + 1 as section_number,
  -- All of the item's moments, not only those in the feed: "Section 2 of 4" stays true.
  (select count(*) from moment m2 where m2.content_item_id = m.content_item_id)::integer
    as section_count,
  m.estimated_minutes, m.link, ci.title as article_title, ci.author,
  s.name as source_name
from user_feed_entry fe
join moment m on m.id = fe.moment_id
join content_item ci on ci.id = m.content_item_id
join source s on s.id = ci.source_id
where s.moments_enabled
  and s.rights_profile in ('full_text_internal', 'full_text_display');
create view starter_feed_visible as
select fe.topic, fe.level, fe.rank, m.id as moment_id, m.title as section_title,
  m.ordinal + 1 as section_number,
  -- All of the item's moments, not only those in the feed: "Section 2 of 4" stays true.
  (select count(*) from moment m2 where m2.content_item_id = m.content_item_id)::integer
    as section_count,
  m.estimated_minutes, m.link, ci.title as article_title, ci.author,
  s.name as source_name
from starter_feed_entry fe
join moment m on m.id = fe.moment_id
join content_item ci on ci.id = m.content_item_id
join source s on s.id = ci.source_id
where s.moments_enabled
  and s.rights_profile in ('full_text_internal', 'full_text_display');
