-- Phase 2 §8 "Continuity: path progress" (P2-W10-S06, Q-P2-28): sections passed per
-- active path in the last full week, by beta group. Athena (Trino) SQL over the
-- events table.
-- The week runs from 14 days ago to 7 days ago, as quiz_return's. A user's path was
-- active that week when they started (or resumed) it during the week, or when their
-- last start or pause of it before the week was a start. A section passed is a passed
-- checkpoint_finished on it that week, once per user and section; a checkpoint closed
-- at its clock records one too (owner, 2026-10-28). It counts for its path when that
-- path was active.
-- Known limit: nothing records a path being finished or retired, so a finished path
-- stays active (with 0 sections a week) until the user pauses it or starts another.
with bounds as (
  select cast(current_date as timestamp) - interval '14' day as week_start,
         cast(current_date as timestamp) - interval '7' day as week_end
),
moves as (
  select user_id, beta_group, props.path_id as path_id, name,
         from_iso8601_timestamp(occurred_at) as at
  from events
  where name in ('path_started', 'path_paused')
),
before_week as (
  select m.user_id, m.path_id, max_by(m.name, m.at) as last
  from moves m cross join bounds b
  where m.at < b.week_start
  group by m.user_id, m.path_id
),
active as (
  select user_id, path_id from before_week where last = 'path_started'
  union
  select m.user_id, m.path_id
  from moves m cross join bounds b
  where m.name = 'path_started' and m.at >= b.week_start and m.at < b.week_end
),
groups as (
  select user_id, min(beta_group) as beta_group from moves group by user_id
),
passed as (
  select distinct e.user_id, e.props.path_id as path_id,
         e.props.section_id as section_id
  from events e cross join bounds b
  where e.name = 'checkpoint_finished' and e.props.passed
    and from_iso8601_timestamp(e.occurred_at) >= b.week_start
    and from_iso8601_timestamp(e.occurred_at) < b.week_end
),
per_path as (
  select a.user_id, a.path_id, count(p.section_id) as sections
  from active a
  left join passed p on p.user_id = a.user_id and p.path_id = a.path_id
  group by a.user_id, a.path_id
)
select g.beta_group,
       count(*) as active_paths,
       sum(pp.sections) as sections_passed,
       cast(sum(pp.sections) as double) / count(*) as sections_per_path
from per_path pp
join groups g on g.user_id = pp.user_id
group by g.beta_group
order by g.beta_group
