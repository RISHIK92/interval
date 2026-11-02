-- migrate:up
-- P3-W14-S03 (§6.7, ADR-0032, Q-P3-09): a player's university, picked from a list
-- (seeded by `load-universities`) or typed when it's missing. Unverified, and no
-- university email is stored. Two players typing the same name share one row; the
-- owner merges, renames or removes typed rows at /admin/universities.
create table university (
  id bigint generated always as identity primary key,
  name text not null check (length(name) between 2 and 120),
  country text check (country ~ '^[A-Z]{2}$'),
  listed boolean not null,
  created_at timestamptz not null default now()
);
create unique index university_listed_key on university (name, country) where listed;
create unique index university_typed_key on university (lower(name)) where not listed;

-- Changed at most once in 30 days; removing it is always allowed and keeps the clock
-- (owner, 2026-11-02, as player_country). A removed typed university leaves its
-- members with none.
create table player_university (
  user_id text primary key references app_user (id) on delete cascade,
  university_id bigint references university (id) on delete set null,
  changed_at timestamptz not null default now()
);

-- migrate:down
drop table player_university;
drop table university;
