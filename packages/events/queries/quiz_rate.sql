-- Phase 2 "done when": at least 30% of finished moments lead to a quiz (P2-W9-S08,
-- Q-P2-20), by beta group. Athena (Trino) SQL over the events table.
-- A finished moment is a user's first section_finished of that moment. It led to a
-- quiz when the same user started Test 60s (quiz_started version 2, kind test) on
-- that moment within a day of finishing it, before or after: the reader's Test me
-- usually comes before Mark done. Only finishes a day or more old: their window has
-- closed. Reviews aren't quizzes on a moment.
with finished as (
  select user_id, min(beta_group) as beta_group, props.moment_id as moment_id,
         min(from_iso8601_timestamp(occurred_at)) as finished_at
  from events
  where name = 'section_finished' and version >= 2 and props.moment_id is not null
  group by user_id, props.moment_id
),
eligible as (
  select * from finished
  where finished_at <= cast(current_date as timestamp) - interval '1' day
),
quizzes as (
  select user_id, props.moment_id as moment_id,
         from_iso8601_timestamp(occurred_at) as started_at
  from events
  where name = 'quiz_started' and version >= 2 and props.kind = 'test'
),
scored as (
  select f.user_id, f.moment_id, f.beta_group, count(q.user_id) > 0 as quizzed
  from eligible f
  left join quizzes q
    on q.user_id = f.user_id
   and q.moment_id = f.moment_id
   and q.started_at > f.finished_at - interval '1' day
   and q.started_at < f.finished_at + interval '1' day
  group by f.user_id, f.moment_id, f.beta_group
)
select beta_group,
       count(*) as finished,
       count_if(quizzed) as quizzed,
       cast(count_if(quizzed) as double) / count(*) as rate
from scored
group by beta_group
order by beta_group
