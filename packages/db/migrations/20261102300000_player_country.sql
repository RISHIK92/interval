-- migrate:up
-- P3-W14-S02 (§6.7, Q-P3-08): a player's country, chosen on Profile, optional, changed
-- at most once in 30 days; removing it is always allowed and keeps the clock (owner,
-- 2026-11-02). Country boards list players by their country now. Accounts only:
-- guests have no Profile (ADR-0029).
create table player_country (
  user_id text primary key references app_user (id) on delete cascade,
  country text check (country ~ '^[A-Z]{2}$'),
  changed_at timestamptz not null default now()
);

-- migrate:down
drop table player_country;
