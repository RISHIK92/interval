-- migrate:up
-- P5-W33 (§6.2, AI-1, AI-2, OPS-4; Q-P5-13): "ask the interviewer" in AI-league
-- battles. A problem's interviewer notes (its interviewer.md) are what the model answers
-- from; they never reach a player. Each question and its answer is kept for review, the
-- answer labelled AI wherever it's shown.
alter type ai_feature add value if not exists 'interviewer';

alter table lld_problem add column interviewer_notes text
  check (interviewer_notes is null or length(interviewer_notes) between 1 and 20000);

create table battle_question (
  id bigint generated always as identity primary key,
  match_id uuid not null references game_match (id) on delete cascade,
  user_id text not null references app_user (id) on delete cascade,
  question text not null check (char_length(question) between 1 and 500),
  asked_at timestamptz not null default now(),
  status text not null default 'pending'
    check (status in ('pending', 'answered', 'unavailable')),
  answer text check (answer is null or char_length(answer) <= 2000),
  model text,
  answered_at timestamptz,
  check ((status = 'answered') = (answer is not null))
);
create index battle_question_player on battle_question (match_id, user_id);

-- migrate:down
drop table battle_question;
alter table lld_problem drop column interviewer_notes;
-- ai_feature keeps 'interviewer': Postgres can't drop an enum value.
