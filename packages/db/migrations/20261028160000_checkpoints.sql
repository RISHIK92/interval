-- migrate:up
-- Checkpoints (§5F, Q-P2-26, P2-W10-S04): a 60-second quiz on a path section, taken
-- once its readings are finished. It holds up to 5 questions; its size is fixed at
-- the start, and so its pass mark: 4 of 5, else all but one, at least 1 (owner,
-- 2026-10-28). Running out the clock doesn't lower it. Whether it passed is settled
-- once, at its finish, and kept: answers can go later with their question (a re-split
-- or a rights purge), and a pass must not. The next section opens on a pass.
alter table quiz_attempt
  add column path_section_id bigint references path_section (id) on delete cascade,
  add column checkpoint_size smallint check (checkpoint_size between 1 and 5),
  add column pass_mark smallint generated always as (
    case when checkpoint_size >= 5 then 4 else greatest(checkpoint_size - 1, 1) end
  ) stored,
  add column checkpoint_passed boolean,
  drop constraint quiz_attempt_review_shape,
  -- Three kinds: Test 60s (an article, a clock), a review (neither), a checkpoint (a
  -- section and its size, a clock, no article).
  add constraint quiz_attempt_shape check (
    (review and content_item_id is null and moment_id is null and ends_at is null
      and path_section_id is null and checkpoint_size is null
      and checkpoint_passed is null)
    or (not review and content_item_id is not null and ends_at is not null
      and path_section_id is null and checkpoint_size is null
      and checkpoint_passed is null)
    or (not review and path_section_id is not null and checkpoint_size is not null
      and content_item_id is null and moment_id is null and ends_at is not null)
  );

-- One running checkpoint per user and section: a double tap meets the same one
-- (LOAD-5).
create unique index quiz_attempt_one_open_checkpoint
  on quiz_attempt (user_id, path_section_id)
  where path_section_id is not null and finished_at is null;
create index quiz_attempt_section on quiz_attempt (path_section_id)
  where path_section_id is not null;

-- migrate:down
delete from quiz_attempt where path_section_id is not null;
drop index quiz_attempt_section;
drop index quiz_attempt_one_open_checkpoint;
alter table quiz_attempt
  drop constraint quiz_attempt_shape,
  drop column checkpoint_passed,
  drop column pass_mark,
  drop column checkpoint_size,
  drop column path_section_id,
  add constraint quiz_attempt_review_shape check (
    review = (content_item_id is null)
    and review = (ends_at is null)
    and (not review or moment_id is null)
  );
