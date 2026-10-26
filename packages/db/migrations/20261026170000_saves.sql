-- migrate:up
-- Save (§5C, Q-P1-15, P1-W4-S07): a saved item anchors similar ones in ranking
-- (Q-P1-13) and W5-S04's Library lists them. Not an explicit topic choice (PER-1).
create table user_save (
  user_id text not null references app_user (id) on delete cascade,
  content_item_id bigint not null references content_item (id) on delete cascade,
  saved_at timestamptz not null default now(),
  primary key (user_id, content_item_id)
);

-- migrate:down
drop table user_save;
