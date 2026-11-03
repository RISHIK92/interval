-- migrate:up
-- P3-W17-S04 (§7, C-09, C-10, LOAD-5, Q-P3-28; owner, 2026-11-03): the agent hook.
-- A device sends only "started" and "finished" (never prompts or code); its token is
-- kept as a hash. "Finished" saves the page the player had open.
create table agent_device (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references app_user (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
create index agent_device_user on agent_device (user_id);

create table agent_task (
  id bigint generated always as identity primary key,
  device_id uuid not null references agent_device (id) on delete cascade,
  user_id text not null references app_user (id) on delete cascade,
  started_at timestamptz not null,
  finished_at timestamptz,
  -- LOAD-5: a call repeated with its key does nothing twice.
  start_key text not null check (char_length(start_key) between 8 and 100),
  finish_key text check (char_length(finish_key) between 8 and 100),
  unique (device_id, start_key),
  unique (device_id, finish_key),
  check (finished_at is null or finished_at >= started_at)
);
create index agent_task_running on agent_task (user_id, started_at desc)
  where finished_at is null;

-- Where the player was when their agent finished, for 24 hours or until opened.
create table agent_place (
  user_id text primary key references app_user (id) on delete cascade,
  path text not null check (path ~ '^/[^/]' and char_length(path) <= 300),
  saved_at timestamptz not null,
  opened_at timestamptz
);

-- migrate:down
drop table agent_place;
drop table agent_task;
drop table agent_device;
