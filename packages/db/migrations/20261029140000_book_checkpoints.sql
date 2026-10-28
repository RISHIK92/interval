-- migrate:up
-- Book checkpoints (§5F, Q-P2-35, P2-W11-S06): a 60-second quiz at a chapter's end,
-- its questions made from that chapter only when the user reaches it (owner,
-- 2026-10-28), by the W8 generator and validator (Q-1).
--
-- A question now belongs to a moment (the public bank) or to a book chapter (private
-- to the book's owner). Every public read joins moment, so a chapter's questions
-- never reach anyone else's quiz, review or the admin spot-check.
alter table question
  alter column moment_id drop not null,
  add column book_chapter_id bigint references book_chapter (id) on delete cascade,
  add constraint question_one_home check (num_nonnulls(moment_id, book_chapter_id) = 1);
create unique index question_one_per_chapter_slot on question (book_chapter_id, ordinal)
  where book_chapter_id is not null;

-- The chapter's concepts, from the W3 tagger run on its sessions: a pass marks them
-- practiced (Q-P2-26).
create table book_chapter_concept (
  chapter_id bigint not null references book_chapter (id) on delete cascade,
  concept_id bigint not null references concept (id) on delete cascade,
  primary key (chapter_id, concept_id)
);

-- Whether the chapter's checkpoint is being made, made, or couldn't be.
create type book_checkpoint_status as enum ('preparing', 'ready', 'failed');
create table book_chapter_checkpoint (
  chapter_id bigint primary key references book_chapter (id) on delete cascade,
  status book_checkpoint_status not null default 'preparing',
  failure text check (char_length(failure) <= 200),
  -- Bumped by each request, so a retry after a failure gets a fresh job key.
  requests integer not null default 1 check (requests >= 1),
  requested_at timestamptz not null default now(),
  ready_at timestamptz,
  check ((status = 'failed') = (failure is not null))
);

-- A fourth kind of attempt: a book checkpoint (a chapter and its size, a clock).
alter table quiz_attempt
  add column book_chapter_id bigint references book_chapter (id) on delete cascade,
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
  );
create unique index quiz_attempt_one_open_book_checkpoint
  on quiz_attempt (user_id, book_chapter_id)
  where book_chapter_id is not null and finished_at is null;
create index quiz_attempt_book_chapter on quiz_attempt (book_chapter_id)
  where book_chapter_id is not null;

-- migrate:down
delete from quiz_attempt where book_chapter_id is not null;
drop index quiz_attempt_book_chapter;
drop index quiz_attempt_one_open_book_checkpoint;
alter table quiz_attempt
  drop constraint quiz_attempt_shape,
  drop column book_chapter_id,
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
drop table book_chapter_checkpoint;
drop type book_checkpoint_status;
drop table book_chapter_concept;
delete from question where book_chapter_id is not null;
drop index question_one_per_chapter_slot;
alter table question
  drop constraint question_one_home,
  drop column book_chapter_id,
  alter column moment_id set not null;
