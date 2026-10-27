-- Phase 2 "done when": quiz takers return more often than non-takers (P2-W9-S08,
-- Q-P2-20). Athena (Trino) SQL over the events table.
-- The week is the last full one before this: from 14 days ago to 7 days ago. Its
-- users are those with a session then (guests left out, as Phase 1's return rate
-- does); a taker finished a quiz that week. Returned: any session in the 7 days after.
with active as (
  select distinct user_id
  from events
  where name = 'session_started' and not is_guest
    and from_iso8601_timestamp(occurred_at)
        >= cast(current_date as timestamp) - interval '14' day
    and from_iso8601_timestamp(occurred_at)
        < cast(current_date as timestamp) - interval '7' day
),
takers as (
  select distinct user_id
  from events
  where name = 'quiz_finished'
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
         t.user_id is not null as took,
         r.user_id is not null as came_back
  from active a
  left join takers t on t.user_id = a.user_id
  left join returned r on r.user_id = a.user_id
)
select case when took then 'takers' else 'non-takers' end as quiz,
       count(*) as users,
       count_if(came_back) as returned,
       cast(count_if(came_back) as double) / count(*) as rate
from scored
group by took
order by quiz
