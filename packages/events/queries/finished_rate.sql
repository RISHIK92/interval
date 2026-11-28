-- Phase 1 "done when": at least half of opened items get marked finished (Q-P1-21,
-- Q-P1-35, P1-W6-S04), by beta group. Athena (Trino) SQL over the events table.
-- ADR-0058: an article is the only reading unit. An open is the first card_opened per
-- user and article; an open from before it that named a moment is an open of that
-- moment's article. It is finished by article_completed of that article (or, before
-- ADR-0058, article_finished) within 7 days of the open. A finished section never
-- completed its article, so section_finished doesn't count. Guests count. Only opens
-- 7+ days old: their window has closed (owner, 2026-10-26). Version 2 events carry the
-- ids; earlier ones can't be matched and are left out.
-- shortcut: opens and finishes match on user_id, so a guest's opens finished after
-- merging into an account (guest_merged, W1-S12, not built yet) don't match; map ids
-- through guest_merged once merging exists.
with opens as (
  -- ADR-0056: users with no beta group count in a group of their own, 'none'.
  select user_id, coalesce(min(beta_group), 'none') as beta_group,
         props.item_id as item_id,
         min(from_iso8601_timestamp(occurred_at)) as opened_at
  from events
  where name = 'card_opened' and version >= 2
  group by user_id, props.item_id
),
eligible as (
  select * from opens
  where opened_at <= cast(current_date as timestamp) - interval '7' day
),
finishes as (
  select user_id, props.item_id as item_id,
         from_iso8601_timestamp(occurred_at) as finished_at
  from events
  where name = 'article_completed'
     or (name = 'article_finished' and version >= 2)
),
scored as (
  select o.user_id, o.item_id, o.beta_group, count(f.user_id) > 0 as finished
  from eligible o
  left join finishes f
    on f.user_id = o.user_id
   and f.item_id = o.item_id
   and f.finished_at >= o.opened_at
   and f.finished_at < o.opened_at + interval '7' day
  group by o.user_id, o.item_id, o.beta_group
)
select beta_group,
       count(*) as opened,
       count_if(finished) as finished,
       cast(count_if(finished) as double) / count(*) as rate
from scored
group by beta_group
order by beta_group
