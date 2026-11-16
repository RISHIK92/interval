-- migrate:up
-- P6-W42 (MATCH-7, Q-P6-06): HLD's ranked windows, at LLD's times with a registration
-- of their own. At a window's start its registrants are grouped by HLD room rating into
-- rooms of up to 4, all on one pooled variant; one left alone plays solo, unranked.
create table hld_window_registration (
  window_at timestamptz not null,
  user_id text not null references app_user (id) on delete cascade,
  league text not null check (league in ('human', 'ai')),
  registered_at timestamptz not null default now(),
  match_id uuid references hld_match (id) on delete set null,
  primary key (window_at, user_id)
);

-- The window's grouping per league, claimed by the first poll at or after its start; a
-- claim older than a minute with players still ungrouped may be taken again.
create table hld_window (
  window_at timestamptz not null,
  league text not null check (league in ('human', 'ai')),
  grouping_at timestamptz not null,
  family text not null,
  seed integer not null,
  primary key (window_at, league)
);

-- migrate:down
drop table hld_window;
drop table hld_window_registration;
