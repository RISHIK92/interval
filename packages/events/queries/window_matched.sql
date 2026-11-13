-- Phase 5 "done when": at least 80% of window registrants get matched (P5-W35-S03,
-- MATCH-7, Q-P5-19). Athena (Trino) SQL over the events table.
-- Each window's grouping, per league, sends one battle_window_grouped (its first claim):
-- how many were registered and how many are in a battle with others. Per ISO week of
-- the last 8.
select cast(date_trunc('week', from_iso8601_timestamp(occurred_at)) as date) as week,
       sum(props.registered) as registered,
       sum(props.matched) as matched,
       cast(sum(props.matched) as double) / sum(props.registered) as share
from events
where name = 'battle_window_grouped'
  and from_iso8601_timestamp(occurred_at)
      >= cast(current_date as timestamp) - interval '56' day
  and props.registered > 0
group by 1
order by 1
