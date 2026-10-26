-- migrate:up
-- Feedback a user gives on the feed (§5C, Q-P1-15, PER-1). Candidate generation
-- (P1-W4-S02) reads it; the feedback controls (W4-S07) write it. None of it changes the
-- user's explicit topic choices (user_preferences).

-- Hide source: an explicit choice, reversible from settings (Q-P1-36).
create table user_hidden_source (
  user_id text not null references app_user (id) on delete cascade,
  source_id bigint not null references source (id),
  hidden_at timestamptz not null default now(),
  primary key (user_id, source_id)
);

-- More/Less like this move the inferred layer; Not interested also hides the item.
-- Whether More and Less like this exclude each other on one item is W4-S07's call.
create type feedback_kind as enum ('more_like_this', 'less_like_this', 'not_interested');

create table item_feedback (
  user_id text not null references app_user (id) on delete cascade,
  content_item_id bigint not null references content_item (id) on delete cascade,
  kind feedback_kind not null,
  given_at timestamptz not null default now(),
  primary key (user_id, content_item_id, kind)
);
create index item_feedback_user_kind on item_feedback (user_id, kind);

-- migrate:down
drop table item_feedback;
drop type feedback_kind;
drop table user_hidden_source;
