-- migrate:up
-- Whole-article entries (§3.2, Q-P1-16, Q-P1-39, P1-W4-S05b): the 8-15 chip shows
-- articles as well as moments, so an entry is a moment or a whole item. The stored feeds
-- are caches; the next recompute fills them again.
drop view starter_feed_visible;
drop view user_feed_visible;
delete from user_feed_entry;
delete from user_feed_state;
delete from starter_feed_entry;

-- An article's reading time from its stored sections (230 words a minute, Q-P1-06);
-- null when there is no body text to count, which a card shows as "Length unknown".
-- shortcut: summed per row on every read; store it on content_item if the views slow.
create function item_minutes(item bigint) returns integer
language sql stable as $$
  -- At least a minute, as segment.minutes counts; greatest() would turn null into 1.
  select case when count(*) = 0 then null
              else greatest(1, ceil(sum(word_count) / 230.0))::integer end
  from content_item_section where content_item_id = item
$$;

-- An entry's moment belongs to its item: the views take the title, source and rights
-- gate from the item, so a mismatch would show one item's link under another's title.
alter table moment add constraint moment_id_item unique (id, content_item_id);

alter table user_feed_entry drop constraint user_feed_entry_pkey;
drop index user_feed_entry_rank;
alter table user_feed_entry
  alter column moment_id drop not null,
  add column content_item_id bigint not null
    references content_item (id) on delete cascade;
alter table user_feed_entry add primary key (user_id, chip, rank);
alter table user_feed_entry add constraint user_feed_entry_moment_item
  foreign key (moment_id, content_item_id) references moment (id, content_item_id)
  on delete cascade;
create unique index user_feed_entry_moment
  on user_feed_entry (user_id, chip, moment_id) where moment_id is not null;
create unique index user_feed_entry_article
  on user_feed_entry (user_id, chip, content_item_id) where moment_id is null;

alter table starter_feed_entry drop constraint starter_feed_entry_pkey;
alter table starter_feed_entry
  alter column moment_id drop not null,
  add column content_item_id bigint not null
    references content_item (id) on delete cascade;
alter table starter_feed_entry add primary key (topic, level, chip, rank);
alter table starter_feed_entry add constraint starter_feed_entry_moment_item
  foreign key (moment_id, content_item_id) references moment (id, content_item_id)
  on delete cascade;
create unique index starter_feed_entry_moment
  on starter_feed_entry (topic, level, chip, moment_id) where moment_id is not null;
create unique index starter_feed_entry_article
  on starter_feed_entry (topic, level, chip, content_item_id) where moment_id is null;

-- Card columns and the rights gate only (§3.2, ING-2). A moment needs a source that
-- allows moments; a whole article only shows its title and link, which every profile
-- allows. The section columns are null for an article.
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

-- migrate:down
drop view starter_feed_visible;
drop view user_feed_visible;
delete from user_feed_entry;
delete from user_feed_state;
delete from starter_feed_entry;
alter table starter_feed_entry drop constraint starter_feed_entry_moment_item;
alter table user_feed_entry drop constraint user_feed_entry_moment_item;
alter table moment drop constraint moment_id_item;
drop index starter_feed_entry_article;
drop index starter_feed_entry_moment;
alter table starter_feed_entry drop constraint starter_feed_entry_pkey;
alter table starter_feed_entry drop column content_item_id;
alter table starter_feed_entry alter column moment_id set not null;
alter table starter_feed_entry add primary key (topic, level, chip, moment_id);
drop index user_feed_entry_article;
drop index user_feed_entry_moment;
alter table user_feed_entry drop constraint user_feed_entry_pkey;
alter table user_feed_entry drop column content_item_id;
alter table user_feed_entry alter column moment_id set not null;
alter table user_feed_entry add primary key (user_id, chip, moment_id);
create index user_feed_entry_rank on user_feed_entry (user_id, chip, rank);
drop function item_minutes(bigint);
create view user_feed_visible as
select fe.user_id, fe.chip, fe.rank, m.id as moment_id, m.title as section_title,
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
select fe.topic, fe.level, fe.chip, fe.rank, m.id as moment_id,
  m.title as section_title, m.ordinal + 1 as section_number,
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
