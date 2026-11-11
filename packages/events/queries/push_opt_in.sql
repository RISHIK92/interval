-- Phase 4 "done when": push opt-in is above 40% (P4-W24-S01, P4-W24-S02), by beta group.
-- Athena (Trino) SQL over the events table. Of the accounts active in the 7 days before
-- today (any event, web or app; guests left out), those with at least one push kind on:
-- each kind's latest push_setting_changed before today said on. ("on" is quoted: a
-- reserved word in Trino.) The plan gate (push.notify, ADR-0036) isn't in events: an
-- account on a plan without push counts as not opted in (owner, 2026-11-11: every
-- weekly active is the base). Two changes to one kind in the same millisecond are
-- ordered by event id: arbitrary, but the same every run.
with active as (
  select user_id, min(beta_group) as beta_group
  from events
  where not is_guest
    -- The agent hook's events come with no visit (§7): not activity.
    and name not in ('agent_task_started', 'agent_task_finished')
    and from_iso8601_timestamp(occurred_at)
        >= cast(current_date as timestamp) - interval '7' day
    and from_iso8601_timestamp(occurred_at) < cast(current_date as timestamp)
  group by user_id
),
latest as (
  select user_id, props."on" as turned_on,
         row_number() over (
           partition by user_id, props.kind
           order by from_iso8601_timestamp(occurred_at) desc, event_id desc
         ) as n
  from events
  where name = 'push_setting_changed'
    and from_iso8601_timestamp(occurred_at) < cast(current_date as timestamp)
),
opted as (
  select distinct user_id from latest where n = 1 and turned_on
)
select a.beta_group,
       count(*) as actives,
       count(o.user_id) as opted_in,
       cast(count(o.user_id) as double) / count(*) as rate
from active a
left join opted o on o.user_id = a.user_id
group by a.beta_group
order by a.beta_group
