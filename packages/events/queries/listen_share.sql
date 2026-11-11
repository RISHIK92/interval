-- Phase 4 "done when": at least 25% of weekly active users listen to an explainer
-- (P4-W24-S02), by beta group. Athena (Trino) SQL over the events table. The week is
-- the 7 days before today; its actives are accounts with any event in it (web or app;
-- guests left out, as they have no reader to listen from, ADR-0029); a listener started
-- an explainer then (explainer_started, P4-W23-S01: a new listen, not a resume).
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
listeners as (
  select distinct user_id
  from events
  where name = 'explainer_started'
    and from_iso8601_timestamp(occurred_at)
        >= cast(current_date as timestamp) - interval '7' day
    and from_iso8601_timestamp(occurred_at) < cast(current_date as timestamp)
)
select a.beta_group,
       count(*) as actives,
       count(l.user_id) as listeners,
       cast(count(l.user_id) as double) / count(*) as rate
from active a
left join listeners l on l.user_id = a.user_id
group by a.beta_group
order by a.beta_group
