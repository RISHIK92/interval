-- migrate:up
-- P3-W15-S04 (Q-P3-21; owner, 2026-11-02): a guest who signs up during a live match plays
-- on as the same player. The guest merge moves the row to the account and keeps here the
-- id the match was made with, which the game server knows; tickets carry that id.
alter table game_match_player add column played_as text;

-- migrate:down
alter table game_match_player drop column played_as;
