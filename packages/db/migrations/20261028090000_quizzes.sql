-- migrate:up
-- Test 60s (Phase 2 Week 9, Q-P2-14, P2-W9-S01): a 60-second sprint over a moment's or
-- an article's concepts. The server holds the clock (`ends_at`) and serves each
-- question; an answer is checked and recorded once (LOAD-5: the attempt and question
-- are the submission's key). Attempts and answers follow their user, article and
-- moment, and a question's answers follow the question (ING-2: a lowered profile
-- purges moments, and with them questions).
create table quiz_attempt (
  id bigint generated always as identity primary key,
  user_id text not null references app_user (id) on delete cascade,
  content_item_id bigint not null references content_item (id) on delete cascade,
  -- null: a quiz on the whole article
  moment_id bigint references moment (id) on delete cascade,
  started_at timestamptz not null default now(),
  ends_at timestamptz not null,
  finished_at timestamptz,
  check (ends_at > started_at)
);
create index quiz_attempt_user on quiz_attempt (user_id, started_at);

-- A row per question served: a refresh gets the same open question back, and a
-- question is never served twice in an attempt (the key). Answered once: chosen,
-- correct and answered_at are set together.
create table quiz_answer (
  attempt_id bigint not null references quiz_attempt (id) on delete cascade,
  question_id bigint not null references question (id) on delete cascade,
  served_at timestamptz not null default now(),
  chosen smallint check (chosen between 0 and 3),
  correct boolean,
  answered_at timestamptz,
  primary key (attempt_id, question_id),
  check ((chosen is null) = (correct is null) and (chosen is null) = (answered_at is null))
);
-- At most one open (served, unanswered) question per attempt.
create unique index quiz_answer_one_open on quiz_answer (attempt_id) where answered_at is null;

-- migrate:down
drop table quiz_answer;
drop table quiz_attempt;
