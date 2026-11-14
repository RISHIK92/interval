-- migrate:up
-- P6-W39 (CANVAS-2, ADR-0042 PROPOSED, Q-P6-03): a player's design for an HLD practice
-- problem, autosaved from the canvas. One per player per problem; `version` counts
-- saves, so a stale tab's save is refused instead of overwriting a newer one. The
-- design is checked against packages/hld's Design schema before it's written.
create table hld_practice_design (
  user_id text not null references app_user (id) on delete cascade,
  problem_slug text not null,
  version integer not null check (version > 0),
  design jsonb not null,
  saved_at timestamptz not null default now(),
  primary key (user_id, problem_slug)
);

-- migrate:down
drop table hld_practice_design;
