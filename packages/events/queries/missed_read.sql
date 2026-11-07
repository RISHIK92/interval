-- Phase 3 "done when": at least 20% of missed concepts lead to reading within 48 hours
-- (P3-W18-S03; owner, 2026-11-05). Athena (Trino) SQL over the events table.
-- A miss is a concept_missed: a section a game or live match sent back to reading.
-- It was read when the same user opened or finished that section within 48 hours
-- after, from anywhere. Only misses 2 to 9 days old: their 48 hours are over.
with missed as (
  select event_id, user_id, props.game as game, props.item_id as item_id,
         props.moment_id as moment_id,
         from_iso8601_timestamp(occurred_at) as missed_at
  from events
  where name = 'concept_missed'
    and from_iso8601_timestamp(occurred_at)
        >= cast(current_date as timestamp) - interval '9' day
    and from_iso8601_timestamp(occurred_at)
        < cast(current_date as timestamp) - interval '2' day
),
reads as (
  select user_id, props.item_id as item_id, props.moment_id as moment_id,
         from_iso8601_timestamp(occurred_at) as read_at
  from events
  where name in ('card_opened', 'section_finished')
),
scored as (
  select m.event_id, m.game, count(r.user_id) > 0 as read
  from missed m
  left join reads r
    on r.user_id = m.user_id
   and r.moment_id = m.moment_id
   and r.read_at >= m.missed_at
   and r.read_at <= m.missed_at + interval '48' hour
  group by m.event_id, m.game
)
select coalesce(game, 'all') as game,
       count(*) as missed,
       count_if(read) as read,
       cast(count_if(read) as double) / count(*) as share
from scored
-- The overall row would be empty without events.
group by grouping sets ((), (game))
having count(*) > 0
order by grouping(game) desc, game
