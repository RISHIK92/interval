-- Phase 3 "done when": players return more often than non-players (P3-W18-S03).
-- Athena (Trino) SQL over the events table, as quiz_return.sql does it: the week is
-- the last full one before this (14 to 7 days ago), its users those with a session
-- then (guests left out); a player started a quick game or was found a live match
-- that week (a friend challenge alone isn't queued, so it isn't playing here). Returned: any session in the 7 days after.
with active as (
  select distinct user_id
  from events
  where name = 'session_started' and not is_guest
    and from_iso8601_timestamp(occurred_at)
        >= cast(current_date as timestamp) - interval '14' day
    and from_iso8601_timestamp(occurred_at)
        < cast(current_date as timestamp) - interval '7' day
),
players as (
  select distinct user_id
  from events
  where name in ('game_started', 'match_found')
    and from_iso8601_timestamp(occurred_at)
        >= cast(current_date as timestamp) - interval '14' day
    and from_iso8601_timestamp(occurred_at)
        < cast(current_date as timestamp) - interval '7' day
),
returned as (
  select distinct user_id
  from events
  where name = 'session_started'
    and from_iso8601_timestamp(occurred_at)
        >= cast(current_date as timestamp) - interval '7' day
    and from_iso8601_timestamp(occurred_at) < cast(current_date as timestamp)
),
scored as (
  select a.user_id,
         p.user_id is not null as played,
         r.user_id is not null as came_back
  from active a
  left join players p on p.user_id = a.user_id
  left join returned r on r.user_id = a.user_id
)
select case when played then 'players' else 'non-players' end as play,
       count(*) as users,
       count_if(came_back) as returned,
       cast(count_if(came_back) as double) / count(*) as rate
from scored
group by played
order by play
