-- migrate:up
-- A fifth kind of attempt (P3-W13-S02, §6.3): the solo 60-second sprint. No target:
-- its questions come from the player's concepts (Q-P3-04), on a clock.
alter table quiz_attempt
  add column sprint boolean not null default false,
  drop constraint quiz_attempt_shape,
  add constraint quiz_attempt_shape check (
    (review and not sprint and content_item_id is null and moment_id is null
      and ends_at is null and path_section_id is null and book_chapter_id is null
      and checkpoint_size is null and checkpoint_passed is null)
    or (not review and not sprint and content_item_id is not null
      and ends_at is not null and path_section_id is null and book_chapter_id is null
      and checkpoint_size is null and checkpoint_passed is null)
    or (not review and not sprint and num_nonnulls(path_section_id, book_chapter_id) = 1
      and checkpoint_size is not null
      and content_item_id is null and moment_id is null and ends_at is not null)
    or (sprint and not review and ends_at is not null
      and content_item_id is null and moment_id is null
      and path_section_id is null and book_chapter_id is null
      and checkpoint_size is null and checkpoint_passed is null)
  );
-- One running sprint per user: a double tap meets the one that won (LOAD-5).
create unique index quiz_attempt_one_open_sprint on quiz_attempt (user_id)
  where sprint and finished_at is null;

-- migrate:down
delete from quiz_attempt where sprint;
drop index quiz_attempt_one_open_sprint;
alter table quiz_attempt
  drop constraint quiz_attempt_shape,
  add constraint quiz_attempt_shape check (
    (review and content_item_id is null and moment_id is null and ends_at is null
      and path_section_id is null and book_chapter_id is null
      and checkpoint_size is null and checkpoint_passed is null)
    or (not review and content_item_id is not null and ends_at is not null
      and path_section_id is null and book_chapter_id is null
      and checkpoint_size is null and checkpoint_passed is null)
    or (not review and num_nonnulls(path_section_id, book_chapter_id) = 1
      and checkpoint_size is not null
      and content_item_id is null and moment_id is null and ends_at is not null)
  ),
  drop column sprint;
