-- migrate:up
-- Starting difficulty (Q-3, Q-P2-11, P2-W8-S04): a question starts at its moment's
-- level when drafted, an admin's correction winning. Every target has a level, so new
-- questions always do; questions drafted before this migration are filled in below.
-- Week 9 recalibrates it from real answers (item response theory), using these counts,
-- and stamps calibrated_at.
alter table question
  add column difficulty difficulty,
  add column answer_count integer not null default 0,
  add column correct_count integer not null default 0,
  add column calibrated_at timestamptz,
  add constraint question_correct_within_answers
    check (correct_count between 0 and answer_count);

update question q
set difficulty = coalesce(lo.difficulty, t.difficulty)
from moment m
left join moment_tagging t on t.moment_id = m.id
left join tag_override lo
  on lo.content_item_id = m.content_item_id
 and lo.heading = m.title and m.link_type <> 'page_top'
where m.id = q.moment_id;

-- migrate:down
alter table question
  drop constraint question_correct_within_answers,
  drop column calibrated_at,
  drop column correct_count,
  drop column answer_count,
  drop column difficulty;
