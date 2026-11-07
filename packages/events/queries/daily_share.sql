-- Phase 3 "done when": at least 40% of daily active users play the daily challenge
-- (P3-W18-S03). Athena (Trino) SQL over the events table.
-- For each UTC day of the last 7 full ones: its active users are those with any event
-- that day, accounts and guests (Play is open to guests, ADR-0029); its players, those
-- who started that day's challenge.
with days as (
  select cast(from_iso8601_timestamp(occurred_at) as date) as day, user_id,
         name = 'game_started' and props.game = 'daily' as played
  from events
  where from_iso8601_timestamp(occurred_at)
        >= cast(current_date as timestamp) - interval '7' day
    and from_iso8601_timestamp(occurred_at) < cast(current_date as timestamp)
),
users as (
  select day, user_id, bool_or(played) as played
  from days
  group by day, user_id
)
select day,
       count(*) as active,
       count_if(played) as played,
       cast(count_if(played) as double) / count(*) as share
from users
group by day
order by day
