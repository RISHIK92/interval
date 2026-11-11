-- Phase 4 "done when": native users retain at least as well as PWA users (Q-P4-14,
-- P4-W24-S02). Athena (Trino) SQL over the events table, the cohort as return_rate.sql
-- has it: accounts that signed up 14+ days before today (their week-two window has
-- closed); guests never sign up, so they are not in it. Native: any event from the app
-- (source ios or android) in the first 7 days after signup (Q-P4-14: by where they were
-- active in their first week); else web (the PWA and the browser). Returned: any event
-- 7 to just under 14 days after signup. Any event, not session_started: the app records
-- no sessions of its own; but not the agent hook's, which a coding agent sends with
-- no visit (§7). "web" is the browser, installed as the PWA or not.
with signups as (
  select user_id, min(from_iso8601_timestamp(occurred_at)) as signed_up_at
  from events
  where name = 'signup_completed' and not is_guest
  group by user_id
),
cohort as (
  select * from signups
  where signed_up_at <= cast(current_date as timestamp) - interval '14' day
),
scored as (
  select c.user_id,
         count_if(
           e.source in ('ios', 'android')
           and from_iso8601_timestamp(e.occurred_at) < c.signed_up_at + interval '7' day
         ) > 0 as native,
         count_if(
           from_iso8601_timestamp(e.occurred_at) >= c.signed_up_at + interval '7' day
           and from_iso8601_timestamp(e.occurred_at) < c.signed_up_at + interval '14' day
         ) > 0 as returned
  from cohort c
  left join events e
    on e.user_id = c.user_id
   and from_iso8601_timestamp(e.occurred_at) >= c.signed_up_at
   and from_iso8601_timestamp(e.occurred_at) < c.signed_up_at + interval '14' day
   and e.name not in ('agent_task_started', 'agent_task_finished')
  group by c.user_id
)
select case when native then 'native' else 'web' end as platform,
       count(*) as cohort,
       count_if(returned) as returned,
       cast(count_if(returned) as double) / count(*) as rate
from scored
group by native
order by platform
