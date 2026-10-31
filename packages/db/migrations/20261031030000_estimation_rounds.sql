-- migrate:up
-- Solo estimation (P3-W13-S04, §6.3, C-27): a sprint whose questions are estimates,
-- each answered with a number and scored 0 to 1. An estimate's answer never sets
-- `correct`: it is a game score only (owner, 2026-10-31), so mastery, FSRS and the
-- difficulty calibration, which all read `correct`, never count it.
alter table quiz_attempt
  add column estimation boolean not null default false,
  add constraint quiz_attempt_estimation_is_sprint check (not estimation or sprint);
-- One running sprint and one running estimation round per user (LOAD-5).
drop index quiz_attempt_one_open_sprint;
create unique index quiz_attempt_one_open_sprint on quiz_attempt (user_id, estimation)
  where sprint and finished_at is null;

alter table quiz_answer
  add column guess double precision check (guess > 0 and guess < 'Infinity'),
  add column score double precision check (score between 0 and 1),
  drop constraint quiz_answer_check,
  add constraint quiz_answer_answered check (
    (answered_at is null and chosen is null and correct is null
      and guess is null and score is null)
    or (answered_at is not null and chosen is not null and correct is not null
      and guess is null and score is null)
    or (answered_at is not null and guess is not null and score is not null
      and chosen is null and correct is null)
  );

-- migrate:down
delete from quiz_attempt where estimation;
alter table quiz_answer
  drop constraint quiz_answer_answered,
  add constraint quiz_answer_check check (
    (chosen is null) = (correct is null) and (chosen is null) = (answered_at is null)
  ),
  drop column score,
  drop column guess;
drop index quiz_attempt_one_open_sprint;
create unique index quiz_attempt_one_open_sprint on quiz_attempt (user_id)
  where sprint and finished_at is null;
alter table quiz_attempt
  drop constraint quiz_attempt_estimation_is_sprint,
  drop column estimation;
