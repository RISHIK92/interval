-- migrate:up
-- P3-W18-S02 (§6.9, ADR-0006 C-14, Q-P3-20): fair-play signals from a live match, as its
-- game server recorded them (an answer under 400 ms compensated, a focus change in a
-- live round), and a flag for review when a player had 3 or more. Flags go to review
-- before any penalty; a penalty removes the rating that match gained (owner,
-- 2026-11-05), never touching the account.
alter table game_match_player add column signals jsonb
  check (signals is null or jsonb_typeof(signals) = 'array');

create table fair_play_flag (
  id bigint generated always as identity primary key,
  match_id uuid not null references game_match (id) on delete cascade,
  user_id text not null references app_user (id) on delete cascade,
  signals integer not null check (signals >= 3),
  created_at timestamptz not null default now(),
  decision text check (decision in ('dismissed', 'penalized')),
  decided_at timestamptz,
  decided_by text references app_user (id) on delete set null,
  -- The rating removed: the match's gain, 0 when it gained nothing or was unrated.
  penalty double precision check (penalty >= 0),
  unique (match_id, user_id),
  check ((decision is null) = (decided_at is null)),
  check ((decision = 'penalized') = (penalty is not null))
);
create index fair_play_flag_pending on fair_play_flag (created_at)
  where decision is null;
create index fair_play_flag_user on fair_play_flag (user_id);

-- migrate:down
drop table fair_play_flag;
alter table game_match_player drop column signals;
