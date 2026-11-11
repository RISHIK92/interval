-- migrate:up
-- Opt-in pushes (Q-P4-13, P4-W24-S01b): at most one a day in the user's own day. The
-- sender claims the day before sending (LOAD-5), so two runs never send twice.
create table push_sent (
  user_id text not null references app_user (id) on delete cascade,
  local_day date not null,
  kind text not null check (kind in ('daily_challenge', 'path_reminder', 'digest')),
  sent_at timestamptz not null default now(),
  primary key (user_id, local_day)
);

-- migrate:down
drop table push_sent;
