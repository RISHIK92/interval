-- migrate:up
-- P3-W15-S02 (ADR-0033; owner, 2026-11-02): a live match, the game server that owns it,
-- and its players, accounts or guests (ADR-0029). The web app issues a match ticket only
-- to a player of the match; matchmaking (W16) writes these rows.
create table game_match (
  id uuid primary key default gen_random_uuid(),
  server_id integer not null check (server_id >= 0),
  created_at timestamptz not null default now()
);

create table game_match_player (
  match_id uuid not null references game_match (id) on delete cascade,
  user_id text not null references app_user (id) on delete cascade,
  primary key (match_id, user_id)
);
-- A player's matches (the guest merge moves them).
create index game_match_player_user on game_match_player (user_id);

-- migrate:down
drop table game_match_player;
drop table game_match;
