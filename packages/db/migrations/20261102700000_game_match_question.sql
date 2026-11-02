-- migrate:up
-- P3-W15-S03 (Q-P3-22; owner, 2026-11-02): the questions a live match plays, in order.
-- The web app picks them when it makes the match and hands them, keys included, to the
-- owning game server through Valkey; results (S05) read them here.
create table game_match_question (
  match_id uuid not null references game_match (id) on delete cascade,
  round smallint not null check (round between 1 and 20),
  question_id bigint not null references question (id),
  primary key (match_id, round)
);
-- A question's matches: results (S05), and deleting a question checks here.
create index game_match_question_question on game_match_question (question_id);

-- migrate:down
drop table game_match_question;
