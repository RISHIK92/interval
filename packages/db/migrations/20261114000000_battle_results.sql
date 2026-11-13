-- migrate:up
-- A battle player's place (1 the best: points, then time, the abandoned last together;
-- Q-P5-18), recorded by the worker with the result, for the results page.
alter table game_match_player add column place smallint check (place between 1 and 4);

-- P5-W35 (§6.5, DB-6; Q-P5-14, Q-P5-22): what a battle leaves for its results page.
-- Each player's best submission, in the private bucket at `key` (pruned with the
-- snapshots: 90 days, or until the match's flags are decided), for the AI code review.
create table battle_best_submission (
  match_id uuid not null references game_match (id) on delete cascade,
  user_id text not null references app_user (id) on delete cascade,
  language text not null,
  key text not null unique,
  taken_at timestamptz not null default now(),
  primary key (match_id, user_id)
);

-- The AI code review of a player's best submission (§6.5: optional, after the match,
-- never affecting ratings), on request; labelled AI and stored apart from the code
-- (AI-1, AI-3). One per player per battle.
alter type ai_feature add value if not exists 'code_review';
create table battle_review (
  match_id uuid not null references game_match (id) on delete cascade,
  user_id text not null references app_user (id) on delete cascade,
  requested_at timestamptz not null default now(),
  status text not null default 'pending'
    check (status in ('pending', 'ready', 'unavailable')),
  review text check (review is null or char_length(review) <= 6000),
  model text,
  reviewed_at timestamptz,
  check ((status = 'ready') = (review is not null)),
  primary key (match_id, user_id)
);

-- Q-P5-22: a player disputes a battle's result, once, within 7 days; the owner upholds
-- or dismisses it with a note at /admin/disputes. Nothing changes a rating by itself.
create table battle_dispute (
  match_id uuid not null references game_match (id) on delete cascade,
  user_id text not null references app_user (id) on delete cascade,
  reason text not null check (char_length(reason) between 1 and 1000),
  created_at timestamptz not null default now(),
  decision text check (decision in ('upheld', 'dismissed')),
  note text check (note is null or char_length(note) <= 1000),
  decided_at timestamptz,
  decided_by text references app_user (id) on delete set null,
  check ((decision is null) = (decided_at is null)),
  primary key (match_id, user_id)
);
create index battle_dispute_pending on battle_dispute (created_at)
  where decision is null;

-- migrate:down
drop table battle_dispute;
drop table battle_review;
drop table battle_best_submission;
alter table game_match_player drop column place;
-- ai_feature keeps 'code_review': Postgres can't drop an enum value.
