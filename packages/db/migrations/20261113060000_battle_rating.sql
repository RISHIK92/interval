-- migrate:up
-- P5-W32-S01a (MATCH-1, ADR-0034; Q-P5-11, Q-P5-18): 1v1 battle ratings, Glicko-2, one
-- per league and apart from quick games' (player_rating). A match's league: quick games
-- are human-only (§6.2), so every match so far is truly 'human'; the AI league's
-- battles (W33) say 'ai'.
alter table game_match add column league text not null default 'human'
  check (league in ('human', 'ai'));

create table battle_rating (
  user_id text not null references app_user (id) on delete cascade,
  league text not null check (league in ('human', 'ai')),
  rating double precision not null,
  rd double precision not null,
  volatility double precision not null,
  games integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, league)
);

-- Each rated battle's change per player, as rating_history is for quick games.
create table battle_rating_history (
  match_id uuid not null references game_match (id) on delete cascade,
  user_id text not null references app_user (id) on delete cascade,
  league text not null check (league in ('human', 'ai')),
  rating_before double precision not null,
  rating_after double precision not null,
  rd_after double precision not null,
  volatility_after double precision not null,
  score double precision not null check (score in (0, 0.5, 1)),
  at timestamptz not null default now(),
  primary key (match_id, user_id)
);
create index battle_rating_history_user on battle_rating_history (user_id, at);

-- migrate:down
drop table battle_rating_history;
drop table battle_rating;
alter table game_match drop column league;
