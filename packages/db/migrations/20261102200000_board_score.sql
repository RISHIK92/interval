-- migrate:up
-- P3-W14-S01 (CACHE-3, §6.7): leaderboards are Valkey sorted sets, and these rows are
-- their source of truth: a finished game's score on its board, once per attempt
-- (LOAD-5). The player is the attempt's, so a guest merge (P3-W13-S07) carries them.
-- Boards: 'daily:<day>', and 'sprint:<ISO week>' or 'estimation:<ISO week>' (UTC),
-- named in apps/web/src/server/adapters/valkey-leaderboards.ts.
create table board_score (
  attempt_id bigint primary key references quiz_attempt (id) on delete cascade,
  board text not null,
  score integer not null check (score >= 0)
);
create index board_score_board on board_score (board);

-- migrate:down
drop table board_score;
