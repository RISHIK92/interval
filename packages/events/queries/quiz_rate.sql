-- Phase 2 "done when": at least 30% of finished readings lead to a quiz (P2-W9-S08,
-- Q-P2-20), by beta group. Athena (Trino) SQL over the events table.
-- ADR-0058: a finished reading is a user's first article_completed of an article (or,
-- before ADR-0058, article_finished with its id; a finished section never was). It
-- led to a quiz when the same user started Test 60s (quiz_started version 2 or later,
-- kind test) on that article within a day of completing it, before or after: the
-- reader's Quiz me often comes before Done. A version 2 quiz on one of the article's
-- moments counts for the article. Only completions a day or more old: their window
-- has closed. Reviews aren't quizzes on an article.
with finished as (
  -- ADR-0056: users with no beta group count in a group of their own, 'none'.
  select user_id, coalesce(min(beta_group), 'none') as beta_group,
         props.item_id as item_id,
         min(from_iso8601_timestamp(occurred_at)) as finished_at
  from events
  where name = 'article_completed'
     or (name = 'article_finished' and version >= 2)
  group by user_id, props.item_id
),
eligible as (
  select * from finished
  where finished_at <= cast(current_date as timestamp) - interval '1' day
),
quizzes as (
  select user_id, props.item_id as item_id,
         from_iso8601_timestamp(occurred_at) as started_at
  from events
  where name = 'quiz_started' and version >= 2 and props.kind = 'test'
),
scored as (
  select f.user_id, f.item_id, f.beta_group, count(q.user_id) > 0 as quizzed
  from eligible f
  left join quizzes q
    on q.user_id = f.user_id
   and q.item_id = f.item_id
   and q.started_at > f.finished_at - interval '1' day
   and q.started_at < f.finished_at + interval '1' day
  group by f.user_id, f.item_id, f.beta_group
)
select beta_group,
       count(*) as finished,
       count_if(quizzed) as quizzed,
       cast(count_if(quizzed) as double) / count(*) as rate
from scored
group by beta_group
order by beta_group
