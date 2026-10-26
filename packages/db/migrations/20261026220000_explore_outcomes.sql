-- migrate:up
-- Exploration outcomes (REC-4, P1-W4-S09, P1-W5-S03): an explored feed entry keeps its
-- arm; a user's first open of it counts once as shown, and their first finish of that
-- article once as finished, in explore_arm_outcome.
alter table user_feed_entry
  add column explore_kind text check (explore_kind in ('topic', 'source')),
  add column explore_arm text,
  add constraint user_feed_entry_explore check (
    (explore_kind is null) = (explore_arm is null)
  );

create table user_explore_open (
  user_id text not null references app_user (id) on delete cascade,
  content_item_id bigint not null references content_item (id) on delete cascade,
  kind text not null check (kind in ('topic', 'source')),
  arm text not null,
  opened_at timestamptz not null default now(),
  finished_counted boolean not null default false,
  primary key (user_id, content_item_id)
);

-- migrate:down
drop table user_explore_open;
alter table user_feed_entry drop constraint user_feed_entry_explore;
alter table user_feed_entry drop column explore_arm;
alter table user_feed_entry drop column explore_kind;
