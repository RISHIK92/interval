-- Phase 4 "done when": explainer completion is above 60% (P4-W24-S02), by beta group.
-- Athena (Trino) SQL over the events table. Listens started in the last full week (14
-- to 7 days ago, so each has had a week to finish), counted once per account and
-- explainer (explainer_started counts a new listen, never a resume); completed: an
-- explainer_finished for the same account and explainer at or after that start, before
-- today. Guests have no reader to listen from (ADR-0029).
with started as (
  select user_id, props.explainer_id as explainer_id, min(beta_group) as beta_group,
         min(from_iso8601_timestamp(occurred_at)) as started_at
  from events
  where name = 'explainer_started' and not is_guest
    and from_iso8601_timestamp(occurred_at)
        >= cast(current_date as timestamp) - interval '14' day
    and from_iso8601_timestamp(occurred_at)
        < cast(current_date as timestamp) - interval '7' day
  group by user_id, props.explainer_id
),
scored as (
  select s.beta_group,
         count(f.user_id) > 0 as completed
  from started s
  left join events f
    on f.user_id = s.user_id
   and f.name = 'explainer_finished'
   and f.props.explainer_id = s.explainer_id
   and from_iso8601_timestamp(f.occurred_at) >= s.started_at
   and from_iso8601_timestamp(f.occurred_at) < cast(current_date as timestamp)
  group by s.user_id, s.explainer_id, s.beta_group
)
select beta_group,
       count(*) as started,
       count_if(completed) as completed,
       cast(count_if(completed) as double) / count(*) as rate
from scored
group by beta_group
order by beta_group
