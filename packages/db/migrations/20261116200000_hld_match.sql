-- migrate:up
-- P6-W42 (§6.4, MATCH-1, MATCH-7, ADR-0043 PROPOSED, Q-P6-06): HLD matches, run by the
-- web app. A match is a pooled variant (family, league, seed: the seed rebuilds its
-- problem) with a deadline; each player autosaves design versions (the replay, Q-P6-03)
-- and submits once, or is submitted at the deadline with their last version.
create table hld_match (
  id uuid primary key default gen_random_uuid(),
  family text not null,
  league text not null check (league in ('human', 'ai')),
  seed integer not null,
  unrated boolean not null default false,
  window_at timestamptz, -- a ranked window's match; null for the casual queue or solo
  started_at timestamptz not null default now(),
  deadline_at timestamptz not null,
  closed_at timestamptz, -- every player submitted, or the deadline passed
  scored_at timestamptz,
  rubric_included boolean,
  rated_at timestamptz,
  check (deadline_at > started_at),
  check (scored_at is null or closed_at is not null),
  check ((scored_at is null) = (rubric_included is null))
);
create index hld_match_open on hld_match (deadline_at) where scored_at is null;

create table hld_match_player (
  match_id uuid not null references hld_match (id) on delete cascade,
  user_id text not null references app_user (id) on delete cascade,
  submitted_at timestamptz,
  auto_submitted boolean not null default false,
  design jsonb, -- the design submitted
  simulation_points numeric(4, 1),
  baseline_passed boolean,
  speed_points numeric(4, 1),
  judgement_id uuid references hld_judgement (id) on delete set null,
  total numeric(5, 1),
  place smallint check (place between 1 and 4),
  check ((submitted_at is null) = (design is null)),
  check ((submitted_at is null) = (simulation_points is null)),
  primary key (match_id, user_id)
);
create index hld_match_player_user on hld_match_player (user_id);

-- Every autosave, kept: the design's replay (Q-P6-03). `version` counts a player's saves
-- in a match, so a stale tab's save is refused.
create table hld_design_version (
  match_id uuid not null,
  user_id text not null,
  version integer not null check (version > 0),
  design jsonb not null,
  saved_at timestamptz not null default now(),
  primary key (match_id, user_id, version),
  foreign key (match_id, user_id) references hld_match_player (match_id, user_id)
    on delete cascade
);

-- A judgement for a match's submission; practice's have none. Only practice keeps one
-- request waiting per player and problem (LOAD-5); a match asks once per submission.
alter table hld_judgement
  add column match_id uuid references hld_match (id) on delete cascade;
drop index hld_judgement_one_pending;
create unique index hld_judgement_one_pending on hld_judgement (user_id, problem_slug)
  where status = 'pending' and match_id is null;

-- Q-P6-06: HLD's own ratings, per league, apart from LLD's: Glicko-2 for a 1v1,
-- OpenSkill for a room of 3 or 4 (MATCH-1), computed by the Python worker (ADR-0034).
create table hld_rating (
  user_id text not null references app_user (id) on delete cascade,
  league text not null check (league in ('human', 'ai')),
  rating double precision not null,
  rd double precision not null,
  volatility double precision not null,
  games integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, league)
);
create table hld_rating_history (
  match_id uuid not null references hld_match (id) on delete cascade,
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
create index hld_rating_history_user on hld_rating_history (user_id, at);
create table hld_room_rating (
  user_id text not null references app_user (id) on delete cascade,
  league text not null check (league in ('human', 'ai')),
  mu double precision not null,
  sigma double precision not null check (sigma > 0),
  games integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, league)
);
create table hld_room_rating_history (
  match_id uuid not null references hld_match (id) on delete cascade,
  user_id text not null references app_user (id) on delete cascade,
  league text not null check (league in ('human', 'ai')),
  mu_before double precision not null,
  mu_after double precision not null,
  sigma_after double precision not null,
  rank integer not null check (rank between 1 and 4),
  at timestamptz not null default now(),
  primary key (match_id, user_id)
);
create index hld_room_rating_history_user on hld_room_rating_history (user_id, at);

-- migrate:down
drop table hld_room_rating_history;
drop table hld_room_rating;
drop table hld_rating_history;
drop table hld_rating;
drop index hld_judgement_one_pending;
alter table hld_judgement drop column match_id;
create unique index hld_judgement_one_pending on hld_judgement (user_id, problem_slug)
  where status = 'pending';
drop table hld_design_version;
drop table hld_match_player;
drop table hld_match;
