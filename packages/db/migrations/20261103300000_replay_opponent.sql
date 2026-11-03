-- migrate:up
-- P3-W17-S01, S02 (BOT-1, BOT-2, BOT-4, Q-P3-25, Q-P3-26): a match against a replay, a
-- ghost's recorded run or a synthetic bot. Its seat and the Glicko it is rated as are
-- kept with the match, so the result rates it so however long the run lasts: a ghost
-- at its run's rating then, a bot at the player's own (RD 350).
alter table game_match
  add column replay_seat text,
  add column replay_rating double precision,
  add column replay_rd double precision check (replay_rd > 0),
  add column replay_volatility double precision check (replay_volatility > 0),
  add constraint game_match_replay_whole
    check (num_nulls(replay_seat, replay_rating, replay_rd, replay_volatility) in (0, 4));

-- A bot's correct rate per question (P3-W17-S02): answers that were judged.
create index quiz_answer_question on quiz_answer (question_id)
  where correct is not null;

-- migrate:down
drop index quiz_answer_question;
alter table game_match
  drop constraint game_match_replay_whole,
  drop column replay_volatility,
  drop column replay_rd,
  drop column replay_rating,
  drop column replay_seat;
