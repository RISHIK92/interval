-- migrate:up
-- P5-W31-S02b-2b (§6.5, Q-P5-16; ADR-0033): an LLD battle is a live match of its own
-- mode, on its problem. Its result is stored like any match's (points as total, the best
-- submission's time as time_ms); ratings come in W32.
alter table game_match
  drop constraint game_match_mode_check,
  add constraint game_match_mode_check check (mode in ('sprint', 'fastest_finger', 'battle')),
  add column problem_slug text references lld_problem (slug),
  add constraint game_match_battle_problem_check
    check ((mode = 'battle') = (problem_slug is not null));

-- migrate:down
delete from game_match where mode = 'battle';
alter table game_match
  drop column problem_slug,
  drop constraint game_match_mode_check,
  add constraint game_match_mode_check check (mode in ('sprint', 'fastest_finger'));
