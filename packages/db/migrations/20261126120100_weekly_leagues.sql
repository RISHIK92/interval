-- migrate:up
-- ADR-0045: weekly leagues, activity cohorts of about 30 in six tiers, separate from
-- every rating. Points come from finished matches, battles and passed reading
-- checkpoints (the worker's league_points stage); a new league starts every Monday
-- 00:00 in the week's zone (the worker's close-leagues-due).

-- Bottom up, so a tier compares by its order.
create type league_tier as enum ('bronze', 'silver', 'gold', 'sapphire', 'ruby', 'diamond');

-- One row per league week: the Monday it starts in `time_zone` (BATTLE_WINDOW_TIME_ZONE
-- when it was made). formed_at: Monday's cohorts were cut from last week's players;
-- closed_at: its ranks, outcomes and tier moves are final.
create table league_week (
  id bigint generated always as identity primary key,
  starts_on date not null unique check (extract(isodow from starts_on) = 1),
  time_zone text not null check (char_length(time_zone) between 1 and 64),
  formed_at timestamptz,
  closed_at timestamptz
);

-- A player's tier now. A new player starts in Bronze (ADR-0045).
create table league_player (
  user_id text primary key references app_user (id) on delete cascade,
  tier league_tier not null default 'bronze',
  updated_at timestamptz not null default now()
);

-- size: its members now, kept by whoever places one (the worker), so the cohort with
-- room is found and locked in one statement, and the moves view needs no count.
create table league_cohort (
  id bigint generated always as identity primary key,
  week_id bigint not null references league_week (id) on delete cascade,
  tier league_tier not null,
  size integer not null default 0 check (size >= 0),
  created_at timestamptz not null default now()
);
create index league_cohort_week on league_cohort (week_id, tier);

-- A player in one cohort of a week. pace_days: last week's active days (days with any
-- points, 0 to 7). mid_week: placed by their first points, not on Monday. final_rank and
-- outcome are set once, when the week closes.
create table league_member (
  week_id bigint not null references league_week (id) on delete cascade,
  cohort_id bigint not null references league_cohort (id) on delete cascade,
  user_id text not null references app_user (id) on delete cascade,
  pace_days smallint not null check (pace_days between 0 and 7),
  mid_week boolean not null,
  placed_at timestamptz not null default now(),
  final_rank integer check (final_rank >= 1),
  outcome text check (outcome in ('up', 'stay', 'down')),
  check ((final_rank is null) = (outcome is null)),
  primary key (week_id, user_id)
);
create index league_member_cohort on league_member (cohort_id);

-- The points ledger. The source is the idempotency key (LOAD-5): a retried match result
-- or checkpoint can't score twice. A checkpoint's source is the checkpoint itself
-- (section-<id> or chapter-<id>: only the first pass scores) and the daily challenge's
-- its day (owner, 2026-11-26). A fair-play penalty is a negative row with a key of
-- its own (the flag), never an update. `at` is when the source happened: it picks the
-- week and the day of the daily cap. A row capped to 0 still records the match played.
create table league_points (
  id bigint generated always as identity primary key,
  user_id text not null references app_user (id) on delete cascade,
  week_id bigint not null references league_week (id) on delete cascade,
  source_kind text not null
    check (source_kind in ('match', 'hld_match', 'checkpoint', 'daily', 'fair_play')),
  source_id text not null check (char_length(source_id) between 1 and 64),
  points integer not null,
  reason text not null
    check (reason in ('match', 'bot_match', 'battle', 'checkpoint', 'daily', 'penalty')),
  at timestamptz not null,
  recorded_at timestamptz not null default now(),
  unique (source_kind, source_id, user_id),
  check ((reason = 'penalty') = (source_kind = 'fair_play')),
  check (case when reason = 'penalty' then points < 0 else points >= 0 end)
);
create index league_points_user_week on league_points (user_id, week_id);

-- The rank rule, once for the worker and the web app (ARCH-2): most points first; equal
-- points rank by who reached the total first (their last row that earned points: a
-- capped match or a penalty reaches nothing); a member with no points ranks at the
-- bottom, in the order they were placed.
create view league_standing as
select m.week_id, m.cohort_id, m.user_id,
       coalesce(t.points, 0)::integer as points,
       row_number() over (
         partition by m.cohort_id
         order by coalesce(t.points, 0) desc, t.reached_at asc nulls last,
                  m.placed_at, m.user_id
       )::integer as rank
from league_member m
left join lateral (
  select sum(p.points) as points,
         max(p.at) filter (where p.points > 0) as reached_at
  from league_points p
  where p.user_id = m.user_id and p.week_id = m.week_id
) t on true;

-- How many move, once for both (ADR-0045): up = round(size × 7/30), down = round(size
-- × 5/30), at least 1 each from 4 members; nobody leaves Diamond upward or Bronze
-- downward.
create view league_cohort_moves as
select c.id as cohort_id, c.week_id, c.tier, c.size,
       case when c.tier = 'diamond' then 0
            else greatest(round(c.size * 7 / 30.0)::integer,
                          case when c.size >= 4 then 1 else 0 end)
       end as up,
       case when c.tier = 'bronze' then 0
            else greatest(round(c.size * 5 / 30.0)::integer,
                          case when c.size >= 4 then 1 else 0 end)
       end as down
from league_cohort c;

-- OPS-3: the beta plan has leagues. Guests have the beta plan too (ADR-0029), but are
-- never in leagues: the worker writes no points for them.
insert into plan_capability (plan_id, capability, limit_value) values
  ('beta', 'play.league', null);

-- migrate:down
delete from user_capability where capability = 'play.league';
delete from plan_capability where capability = 'play.league';
drop view league_cohort_moves;
drop view league_standing;
drop table league_points;
drop table league_member;
drop table league_cohort;
drop table league_player;
drop table league_week;
drop type league_tier;
