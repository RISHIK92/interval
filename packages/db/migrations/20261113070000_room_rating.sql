-- migrate:up
-- P5-W32-S01b (MATCH-1, C-03; Q-P5-11, Q-P5-18): room ratings, OpenSkill (Plackett-Luce),
-- for battles of 3 or 4: one per league, apart from 1v1 battles' and quick games'.
create table room_rating (
  user_id text not null references app_user (id) on delete cascade,
  league text not null check (league in ('human', 'ai')),
  mu double precision not null,
  sigma double precision not null check (sigma > 0),
  games integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, league)
);

-- Each rated room's change per player, and the rank it was rated by.
create table room_rating_history (
  match_id uuid not null references game_match (id) on delete cascade,
  user_id text not null references app_user (id) on delete cascade,
  league text not null check (league in ('human', 'ai')),
  mu_before double precision not null,
  mu_after double precision not null,
  sigma_after double precision not null,
  rank integer not null check (rank between 1 and 4),
  at timestamptz not null default now(),
  primary key (match_id, user_id)
);
create index room_rating_history_user on room_rating_history (user_id, at);

-- migrate:down
drop table room_rating_history;
drop table room_rating;
