-- Phase 3 "done when": half of matches start within 10 seconds (P3-W18-S03; owner,
-- 2026-11-05: every live match, a person, a ghost or a bot). Athena (Trino) SQL over
-- the events table. Each player's match_found in the last 7 full days, by its wait in
-- the queue; version 1 had no opponent, and only people were found then. Friend
-- challenges never queue, so they aren't here.
-- Strictly within 10 s (owner, 2026-11-07): the automatic ghost or bot fallback fires
-- just after 10 s, so it is the safety net, not a quick start; its rows show its share.
with found as (
  select coalesce(props.opponent, 'person') as opponent,
         props.wait_ms <= 10000 as quick
  from events
  where name = 'match_found'
    and from_iso8601_timestamp(occurred_at)
        >= cast(current_date as timestamp) - interval '7' day
    and from_iso8601_timestamp(occurred_at) < cast(current_date as timestamp)
)
select coalesce(opponent, 'all') as opponent,
       count(*) as matches,
       count_if(quick) as within_10s,
       cast(count_if(quick) as double) / count(*) as share
from found
-- The overall row would be empty without events.
group by grouping sets ((), (opponent))
having count(*) > 0
order by grouping(opponent) desc, opponent
