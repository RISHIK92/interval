-- migrate:up
-- Following a topic path (§5F, Q-P2-27, P2-W10-S03): a user starts a live path and it
-- becomes their active one; starting another pauses it (one active at a time). A path
-- the owner retires later stays in the user's list, shown as retired.
create type user_path_status as enum ('active', 'paused');

create table user_path (
  user_id text not null references app_user (id) on delete cascade,
  path_id bigint not null references path (id) on delete cascade,
  status user_path_status not null,
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, path_id)
);
create unique index user_path_one_active on user_path (user_id)
  where status = 'active';

-- migrate:down
drop table user_path;
drop type user_path_status;
