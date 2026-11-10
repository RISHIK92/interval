-- migrate:up
-- The audio queue and saved positions (§5G, §5I, P4-W23-S01): per account, so the PWA
-- and the native player (W23-S02) share them.
create table listen_queue (
  user_id text not null references app_user (id) on delete cascade,
  explainer_id bigint not null references concept_explainer (id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (user_id, explainer_id)
);

-- Where a listener is in each explainer, and when they last finished it (Up next leaves
-- finished concepts out; a finished one listened to again starts from 0).
create table explainer_listen (
  user_id text not null references app_user (id) on delete cascade,
  explainer_id bigint not null references concept_explainer (id) on delete cascade,
  position_seconds numeric(8, 2) not null default 0 check (position_seconds >= 0),
  finished_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, explainer_id)
);
create index explainer_listen_finished on explainer_listen (user_id, finished_at desc)
  where finished_at is not null;

-- migrate:down
drop table explainer_listen;
drop table listen_queue;
