-- migrate:up
-- Continue cards (§3.2, §5C, Q-P1-40, P1-W5-S03). A section counts as read for them
-- once it is finished or opened (owner, 2026-10-26: the web can't see reading on the
-- publisher's tab, so opening section 1 offers section 2). Opened is not finished: the
-- "done when" metric and article completion still need Yes or Mark done.
create table user_moment_opened (
  user_id text not null references app_user (id) on delete cascade,
  moment_id bigint not null references moment (id) on delete cascade,
  opened_at timestamptz not null default now(),
  primary key (user_id, moment_id)
);

-- A dismissal hides the card until the reader reads on (owner, 2026-10-26).
create table continue_dismissal (
  user_id text not null references app_user (id) on delete cascade,
  content_item_id bigint not null references content_item (id) on delete cascade,
  dismissed_at timestamptz not null default now(),
  primary key (user_id, content_item_id)
);

-- migrate:down
drop table continue_dismissal;
drop table user_moment_opened;
