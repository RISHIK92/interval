-- migrate:up
-- P5-W32 (§6.6, MATCH-7; Q-P5-12, Q-P5-19): ranked battle windows. A player registers
-- for a window until 5 minutes before it starts; at its start registrants are grouped by
-- room rating into rooms of 4 (3 and 2 for a remainder; 1 plays solo, unranked), all on
-- one problem. The row records the battle each was put in.
create table battle_window_registration (
  window_at timestamptz not null,
  user_id text not null references app_user (id) on delete cascade,
  registered_at timestamptz not null default now(),
  -- Q-P5-19: registering asks for the window's reminder, 15 minutes before, sent when
  -- the battle_window push kind is on (Q-P5-12); claimed once (reminded_at).
  remind_at timestamptz not null,
  reminded_at timestamptz,
  match_id uuid references game_match (id) on delete set null,
  primary key (window_at, user_id)
);
create index battle_window_registration_remind on battle_window_registration (remind_at)
  where reminded_at is null;

-- The window's grouping, claimed by the first poll at or after its start; a claim
-- older than a minute with players still ungrouped may be taken again.
create table battle_window (
  window_at timestamptz primary key,
  grouping_at timestamptz not null,
  problem_slug text not null references lld_problem (slug)
);

-- Q-P5-12: a new opt-in kind, off until turned on.
alter table push_preference add column battle_window boolean not null default false;

-- migrate:down
alter table push_preference drop column battle_window;
drop table battle_window;
drop table battle_window_registration;
