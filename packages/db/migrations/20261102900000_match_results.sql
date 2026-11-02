-- migrate:up
-- P3-W15-S05 (§6.1, PER-2): a live match's result, recorded once by the worker from its
-- game server's message. Each player's answers become a match attempt whose mastery and
-- review evidence the web app applies (evidence_applied_at; ARCH-2: one implementation).
alter table game_match
  add column finished_at timestamptz,
  add column outcome text check (outcome in ('finished', 'abandoned', 'cancelled', 'void')),
  add column winner_id text references app_user (id) on delete set null,
  add check ((finished_at is null) = (outcome is null));

alter table game_match_player
  add column total integer check (total >= 0),
  add column time_ms bigint check (time_ms >= 0),
  add column abandoned boolean;

alter table quiz_attempt
  add column match_id uuid references game_match (id) on delete cascade,
  add column evidence_applied_at timestamptz;
-- A match attempt: a player's answers in a live match, none of the other kinds' columns.
alter table quiz_attempt
  drop constraint quiz_attempt_shape,
  add constraint quiz_attempt_shape check (match_id is not null or ((((daily_day IS NULL) AND ((review AND (NOT sprint) AND (content_item_id IS NULL) AND (moment_id IS NULL) AND (ends_at IS NULL) AND (path_section_id IS NULL) AND (book_chapter_id IS NULL) AND (checkpoint_size IS NULL) AND (checkpoint_passed IS NULL)) OR ((NOT review) AND (NOT sprint) AND (content_item_id IS NOT NULL) AND (ends_at IS NOT NULL) AND (path_section_id IS NULL) AND (book_chapter_id IS NULL) AND (checkpoint_size IS NULL) AND (checkpoint_passed IS NULL)) OR ((NOT review) AND (NOT sprint) AND (num_nonnulls(path_section_id, book_chapter_id) = 1) AND (checkpoint_size IS NOT NULL) AND (content_item_id IS NULL) AND (moment_id IS NULL) AND (ends_at IS NOT NULL)) OR (sprint AND (NOT review) AND (ends_at IS NOT NULL) AND (content_item_id IS NULL) AND (moment_id IS NULL) AND (path_section_id IS NULL) AND (book_chapter_id IS NULL) AND (checkpoint_size IS NULL) AND (checkpoint_passed IS NULL)))) OR ((daily_day IS NOT NULL) AND (NOT review) AND (NOT sprint) AND (ends_at IS NOT NULL) AND (content_item_id IS NULL) AND (moment_id IS NULL) AND (path_section_id IS NULL) AND (book_chapter_id IS NULL) AND (checkpoint_size IS NULL) AND (checkpoint_passed IS NULL))))),
  add constraint quiz_attempt_match_shape check (
    match_id is null or (
      not review and not sprint and not estimation and daily_day is null
      and ends_at is not null and finished_at is not null
      and content_item_id is null and moment_id is null and path_section_id is null
      and book_chapter_id is null and checkpoint_size is null
      and checkpoint_passed is null));
-- A player's match evidence still to apply: checked on every feed and Play view.
create index quiz_attempt_match_pending on quiz_attempt (user_id)
  where match_id is not null and evidence_applied_at is null;

-- migrate:down
drop index quiz_attempt_match_pending;
delete from quiz_attempt where match_id is not null;
alter table quiz_attempt
  drop constraint quiz_attempt_match_shape,
  drop constraint quiz_attempt_shape,
  add constraint quiz_attempt_shape check ((((daily_day IS NULL) AND ((review AND (NOT sprint) AND (content_item_id IS NULL) AND (moment_id IS NULL) AND (ends_at IS NULL) AND (path_section_id IS NULL) AND (book_chapter_id IS NULL) AND (checkpoint_size IS NULL) AND (checkpoint_passed IS NULL)) OR ((NOT review) AND (NOT sprint) AND (content_item_id IS NOT NULL) AND (ends_at IS NOT NULL) AND (path_section_id IS NULL) AND (book_chapter_id IS NULL) AND (checkpoint_size IS NULL) AND (checkpoint_passed IS NULL)) OR ((NOT review) AND (NOT sprint) AND (num_nonnulls(path_section_id, book_chapter_id) = 1) AND (checkpoint_size IS NOT NULL) AND (content_item_id IS NULL) AND (moment_id IS NULL) AND (ends_at IS NOT NULL)) OR (sprint AND (NOT review) AND (ends_at IS NOT NULL) AND (content_item_id IS NULL) AND (moment_id IS NULL) AND (path_section_id IS NULL) AND (book_chapter_id IS NULL) AND (checkpoint_size IS NULL) AND (checkpoint_passed IS NULL)))) OR ((daily_day IS NOT NULL) AND (NOT review) AND (NOT sprint) AND (ends_at IS NOT NULL) AND (content_item_id IS NULL) AND (moment_id IS NULL) AND (path_section_id IS NULL) AND (book_chapter_id IS NULL) AND (checkpoint_size IS NULL) AND (checkpoint_passed IS NULL))));
alter table quiz_attempt drop column evidence_applied_at, drop column match_id;
alter table game_match_player drop column abandoned, drop column time_ms, drop column total;
alter table game_match drop constraint game_match_check;
alter table game_match drop column winner_id, drop column outcome, drop column finished_at;
