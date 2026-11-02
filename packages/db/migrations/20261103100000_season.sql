-- migrate:up
-- P3-W16-S06 (Q-P3-13; owner, 2026-11-03): quick-game seasons, one per calendar month
-- (UTC). Closing one keeps its final board and soft-resets every rating, once.
create table season_close (
  season text primary key check (season ~ '^[0-9]{4}-[0-9]{2}$'),
  closed_at timestamptz not null default now()
);

-- A closed season's final board: each player with a rated match in it, at the rating
-- their last match of the season left them on.
create table season_standing (
  season text not null references season_close (season) on delete cascade,
  user_id text not null references app_user (id) on delete cascade,
  rating double precision not null,
  primary key (season, user_id)
);

-- Whether a player was rated in a season (its board, and a player's season boards).
create index rating_history_user_at on rating_history (user_id, at);

-- migrate:down
drop index rating_history_user_at;
drop table season_standing;
drop table season_close;
