-- migrate:up
-- P6-W41 (CANVAS-6, AI-3, §6.4, Q-P6-05, ADR-0042 PROPOSED): the AI judge's rubric levels
-- and the coach's advice for a design, on the player's request. `input` is what the
-- worker sends the model (packages/hld's JudgeInput), so it's judged as it was when
-- asked. A design that fails the baseline earns no rubric points, so it's coached but
-- never judged (`levels` stays null). Stored apart from the design's own text and
-- labelled AI wherever shown; never touching a rating.
create table hld_judgement (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references app_user (id) on delete cascade,
  problem_slug text not null,
  input jsonb not null,
  baseline_passed boolean not null,
  requested_at timestamptz not null default now(),
  status text not null default 'pending'
    check (status in ('pending', 'ready', 'unavailable')),
  -- {criterion id: {level 0-4, reason}}, the median of 3 runs.
  levels jsonb,
  coach text check (coach is null or char_length(coach) <= 4000),
  model text,
  judged_at timestamptz,
  -- Q-P6-05: one appeal, within 7 days; the owner's levels replace the judge's.
  appeal_reason text check (
    appeal_reason is null or char_length(appeal_reason) between 1 and 500
  ),
  appealed_at timestamptz,
  owner_levels jsonb,
  resolved_at timestamptz,
  resolved_by text references app_user (id) on delete set null,
  check ((appeal_reason is null) = (appealed_at is null)),
  check ((owner_levels is null) = (resolved_at is null)),
  check (resolved_at is null or appealed_at is not null),
  check (status <> 'ready' or judged_at is not null)
);
-- One request waiting per player per problem: asking again while it runs is the same
-- request (LOAD-5).
create unique index hld_judgement_one_pending on hld_judgement (user_id, problem_slug)
  where status = 'pending';
create index hld_judgement_latest on hld_judgement (user_id, problem_slug, requested_at);
create index hld_judgement_appeals on hld_judgement (appealed_at)
  where appealed_at is not null and resolved_at is null;

-- CANVAS-6, AI-5: the owner's grades for the calibration set (packages/hld's
-- calibration.json, by candidate id), one level per criterion.
create table hld_calibration_grade (
  candidate_id text not null,
  criterion_id text not null,
  level smallint not null check (level between 0 and 4),
  graded_by text references app_user (id) on delete set null,
  graded_at timestamptz not null default now(),
  primary key (candidate_id, criterion_id)
);

-- migrate:down
drop table hld_calibration_grade;
drop table hld_judgement;
