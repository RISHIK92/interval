-- migrate:up
-- P3-W16-S01 (MATCH-1, MATCH-2, ADR-0034): one shared quick-game Glicko-2 rating per
-- player, accounts and guests (owner, 2026-11-02), rated once per match by the worker
-- in the transaction that records its result.
create table player_rating (
  user_id text primary key references app_user (id) on delete cascade,
  rating double precision not null,
  rd double precision not null check (rd > 0),
  volatility double precision not null check (volatility > 0),
  games integer not null default 0 check (games >= 0),
  updated_at timestamptz not null default now()
);

create table rating_history (
  id bigint generated always as identity primary key,
  user_id text not null references app_user (id) on delete cascade,
  match_id uuid not null references game_match (id) on delete cascade,
  rating_before double precision not null,
  rating_after double precision not null,
  rd_after double precision not null,
  volatility_after double precision not null,
  score real not null check (score in (0, 0.5, 1)),
  at timestamptz not null default now(),
  unique (user_id, match_id)
);

alter table game_match add column rated_at timestamptz;

-- migrate:down
alter table game_match drop column rated_at;
drop table rating_history;
drop table player_rating;
