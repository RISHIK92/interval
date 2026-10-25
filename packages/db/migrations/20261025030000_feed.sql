-- migrate:up
-- Precomputed feed (CACHE-1). The worker writes it (ADR-0008); the web app only reads
-- feed_visible. Global until Week 4 ranking makes it per user.
create table feed_entry (
  moment_id bigint primary key references moment (id) on delete cascade,
  rank integer not null,
  computed_at timestamptz not null default now()
);

-- What a card may show: section title, position, minutes, link and attribution. No
-- summary, excerpt or private text is reachable from here (§3.2, ING-2). The source
-- filter repeats the moment gate so a stale entry never becomes a card.
create view feed_visible as
select
  fe.rank,
  m.id as moment_id,
  m.title as section_title,
  m.ordinal + 1 as section_number,
  -- All of the item's moments, not only those in the feed: "Section 2 of 4" stays true
  -- when ranking puts only some sections in feed_entry.
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

-- Links open on the publisher's site; only http(s) may reach a card (validate at the
-- boundary: the worker already rejects other schemes).
alter table moment add constraint moment_link_http check (link ~ '^https?://');

-- migrate:down
alter table moment drop constraint moment_link_http;
drop view feed_visible;
drop table feed_entry;
