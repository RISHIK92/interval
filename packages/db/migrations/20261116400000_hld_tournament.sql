-- migrate:up
-- P6-W43 (§6.4, HLDQ-3, Q-P6-07): HLD tournaments, run by the admin: registration, check-in
-- in the hour before the start, 5 Swiss rounds of 1v1 HLD matches, then a top-8 bracket.
-- Every round's problem is a pooled variant the admin picked, retired from matches.
create table hld_tournament (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 3 and 80),
  league text not null check (league in ('human', 'ai')),
  starts_at timestamptz not null,
  -- 0 before the first round; then the round being played or last played (1-5 Swiss,
  -- 6 the quarter-finals, 7 the semi-finals, 8 the final).
  round integer not null default 0 check (round between 0 and 8),
  finished_at timestamptz,
  created_by text references app_user (id) on delete set null,
  created_at timestamptz not null default now()
);

-- Each round's problem, picked when the tournament is made.
create table hld_tournament_round (
  tournament_id uuid not null references hld_tournament (id) on delete cascade,
  round integer not null check (round between 1 and 8),
  family text not null,
  seed integer not null,
  started_at timestamptz,
  primary key (tournament_id, round)
);

create table hld_tournament_entry (
  tournament_id uuid not null references hld_tournament (id) on delete cascade,
  user_id text not null references app_user (id) on delete cascade,
  registered_at timestamptz not null default now(),
  checked_in_at timestamptz,
  -- The player's university as it was at check-in (Q-P3-09): changing it later doesn't
  -- move points between universities.
  university_id bigint references university (id) on delete set null,
  primary key (tournament_id, user_id)
);

-- A round's pairings, in order (`slot`: a bracket's winners pair up in it), written with
-- the round's claim; each pairing's match follows (null until started), and a bye has
-- no opponent and no match.
create table hld_tournament_pairing (
  tournament_id uuid not null references hld_tournament (id) on delete cascade,
  round integer not null check (round between 1 and 8),
  slot integer not null check (slot >= 0),
  player_a text not null references app_user (id) on delete cascade,
  player_b text references app_user (id) on delete cascade,
  match_id uuid references hld_match (id) on delete set null,
  check (player_b is not null or match_id is null),
  primary key (tournament_id, round, player_a),
  unique (tournament_id, round, slot)
);

-- HLDQ-3: a variant used in a tournament is never drawn for a match again.
create table hld_retired_variant (
  family text not null,
  league text not null check (league in ('human', 'ai')),
  seed integer not null,
  retired_at timestamptz not null default now(),
  primary key (family, league, seed)
);

-- migrate:down
drop table hld_retired_variant;
drop table hld_tournament_pairing;
drop table hld_tournament_entry;
drop table hld_tournament_round;
drop table hld_tournament;
