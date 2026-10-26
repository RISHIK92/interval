-- migrate:up
-- Resetting inferred interests (§5A, PER-1, Q-P1-36, P1-W4-S08). A reset deletes More
-- and Less like this and records when it happened: Not interested items given before
-- it stay hidden (the user chose not to see them), but their concepts no longer push
-- other articles down (owner, 2026-10-26).
create table user_inferred_reset (
  user_id text primary key references app_user (id) on delete cascade,
  reset_at timestamptz not null
);

-- The concepts a user's Not interested items push down (Q-P1-15): one definition, read
-- by the worker's ranking and the web's Profile page (ARCH-2). An admin's correction
-- replaces the model's tags (P1-W3-S05).
create view user_avoided_concept as
select distinct f.user_id, c.slug, c.name
from item_feedback f
left join user_inferred_reset r on r.user_id = f.user_id
left join tag_override o on o.content_item_id = f.content_item_id and o.heading = ''
join concept c on (
  (o.content_item_id is not null and c.slug = any(o.concepts))
  or (o.content_item_id is null and c.id in (
    select concept_id from item_concept where content_item_id = f.content_item_id
  ))
)
where f.kind = 'not_interested'
  -- given_at is its transaction's start; a reset stamps clock_timestamp() in its own
  -- transaction, so feedback given after a reset compares later. One racing a reset
  -- may count as before it: it still hides, its concepts just don't count.
  and (r.reset_at is null or f.given_at > r.reset_at);

-- migrate:down
drop view user_avoided_concept;
drop table user_inferred_reset;
