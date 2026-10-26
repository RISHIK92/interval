-- migrate:up
-- Finishes (§5D, ADR-0006 C-22, Q-P1-32, Q-P1-35, P1-W5-S02): from the return prompt or
-- Mark done. The first finish is kept; W5-S03 builds progress and continue cards on it.
create type finish_method as enum ('return_prompt', 'mark_done');

create table user_moment_finished (
  user_id text not null references app_user (id) on delete cascade,
  moment_id bigint not null references moment (id) on delete cascade,
  method finish_method not null,
  finished_at timestamptz not null default now(),
  primary key (user_id, moment_id)
);

create table user_article_finished (
  user_id text not null references app_user (id) on delete cascade,
  content_item_id bigint not null references content_item (id) on delete cascade,
  method finish_method not null,
  finished_at timestamptz not null default now(),
  primary key (user_id, content_item_id)
);

-- migrate:down
drop table user_article_finished;
drop table user_moment_finished;
drop type finish_method;
