-- migrate:up
-- P3-W17-S01 (BOT-1, Q-P3-25; owner, 2026-11-03): each player's side of a finished
-- live match, kept to be replayed as a labeled ghost. Ids and timings only: question
-- ids, the option chosen, and the time on the game server's clock, no text.
create table ghost_run (
  id bigint generated always as identity primary key,
  match_id uuid not null references game_match (id) on delete cascade,
  user_id text not null references app_user (id) on delete cascade,
  mode text not null check (mode in ('sprint', 'fastest_finger')),
  -- The player's Glicko before that match: what a ghost match is rated against.
  rating double precision not null,
  rd double precision not null check (rd > 0),
  volatility double precision not null check (volatility > 0),
  answers jsonb not null check (jsonb_typeof(answers) = 'array'),
  recorded_at timestamptz not null default now(),
  unique (match_id, user_id)
);
-- Picking a ghost: a mode's recent runs.
create index ghost_run_pick on ghost_run (mode, recorded_at);
create index ghost_run_user on ghost_run (user_id);

-- A ghost match replays this run; the player met it (Q-P3-25: never twice first).
alter table game_match
  add column ghost_run_id bigint references ghost_run (id) on delete set null;
create index game_match_ghost_run on game_match (ghost_run_id)
  where ghost_run_id is not null;

-- migrate:down
drop index game_match_ghost_run;
alter table game_match drop column ghost_run_id;
drop table ghost_run;
