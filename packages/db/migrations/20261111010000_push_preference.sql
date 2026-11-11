-- migrate:up
-- Opt-in pushes (Q-P4-13, P4-W24-S01): each kind off until the user turns it on; one
-- hour of the user's day for any of them (owner, 2026-11-11), in their own time zone,
-- taken from the device (an IANA name, checked by the web app).
create table push_preference (
  user_id text primary key references app_user (id) on delete cascade,
  digest boolean not null default false,
  path_reminder boolean not null default false,
  daily_challenge boolean not null default false,
  -- Quiet from 21:00 to 08:00 (Q-P4-13): the hour is between them.
  hour smallint not null default 18 check (hour between 8 and 20),
  -- Every save brings it, so a row always has one.
  time_zone text not null check (char_length(time_zone) between 1 and 64),
  updated_at timestamptz not null default now()
);

-- migrate:down
drop table push_preference;
