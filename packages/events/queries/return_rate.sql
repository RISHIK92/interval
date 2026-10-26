-- Phase 1 "done when": at least 40% of users return the week after signing up
-- (Q-P1-21, P1-W6-S04), by beta group. Athena (Trino) SQL over the events table.
-- Return: any session_started from 7 days to just under 14 days after
-- signup_completed. Guests never sign up, so they are not in it. Only users who signed
-- up 14+ days before today: their window has closed (owner, 2026-10-26).
with signups as (
  select user_id, min(beta_group) as beta_group,
         min(from_iso8601_timestamp(occurred_at)) as signed_up_at
  from events
  where name = 'signup_completed' and not is_guest
  group by user_id
),
cohort as (
  select * from signups
  where signed_up_at <= cast(current_date as timestamp) - interval '14' day
),
returns as (
  select c.user_id, c.beta_group, count(s.user_id) > 0 as returned
  from cohort c
  left join events s
    on s.user_id = c.user_id
   and s.name = 'session_started'
   and from_iso8601_timestamp(s.occurred_at) >= c.signed_up_at + interval '7' day
   and from_iso8601_timestamp(s.occurred_at) < c.signed_up_at + interval '14' day
  group by c.user_id, c.beta_group
)
select beta_group,
       count(*) as cohort,
       count_if(returned) as returned,
       cast(count_if(returned) as double) / count(*) as rate
from returns
group by beta_group
order by beta_group
