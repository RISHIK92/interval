-- Phase 2 "done when": under 2% of questions get flagged (P2-W9-S08, Q-2, Q-P2-20).
-- Athena (Trino) SQL over the events table. Of the questions anyone has answered, the
-- share anyone has flagged; a question flagged by several users counts once. Whole
-- days, up to today.
with answered as (
  select distinct props.question_id as question_id
  from events
  where name = 'quiz_answered'
    and from_iso8601_timestamp(occurred_at) < cast(current_date as timestamp)
),
flagged as (
  select distinct props.question_id as question_id
  from events
  where name = 'question_flagged'
    and from_iso8601_timestamp(occurred_at) < cast(current_date as timestamp)
)
select 'all' as scope,
       count(*) as answered,
       count_if(f.question_id is not null) as flagged,
       coalesce(cast(count_if(f.question_id is not null) as double)
                / nullif(count(*), 0), 0) as rate
from answered a
left join flagged f on f.question_id = a.question_id
