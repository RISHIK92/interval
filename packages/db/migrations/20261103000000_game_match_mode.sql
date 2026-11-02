-- migrate:up
-- P3-W16-S04 (Q-P3-23; owner, 2026-11-03): a live match's mode. A sprint plays 30
-- questions at each player's own pace; the 7 rounds of Q-P3-22 become fastest finger
-- (W16-S05), which every match made before this one was.
alter table game_match
  add column mode text not null default 'fastest_finger'
    check (mode in ('sprint', 'fastest_finger'));

alter table game_match_question
  drop constraint game_match_question_round_check,
  add constraint game_match_question_round_check check (round between 1 and 30);

-- migrate:down
delete from game_match where mode = 'sprint';
alter table game_match_question
  drop constraint game_match_question_round_check,
  add constraint game_match_question_round_check check (round between 1 and 20);
alter table game_match drop column mode;
