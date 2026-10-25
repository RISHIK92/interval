-- migrate:up
-- ING-3 adaptive polling (P1-W2-S03): each source's own interval and next turn. Bounds
-- match interval_jobs.polling (15 minutes to 24 hours); a new source is due at once.
alter table source
  add column poll_interval_seconds integer not null default 3600
    check (poll_interval_seconds between 900 and 86400),
  add column next_poll_at timestamptz not null default now(),
  -- When the interval last adapted: a retried or duplicate discover inside the minimum
  -- interval leaves it alone (LOAD-5).
  add column polled_at timestamptz;

create index source_next_poll_at on source (next_poll_at) where active;

-- migrate:down
drop index source_next_poll_at;
alter table source
  drop column polled_at,
  drop column next_poll_at,
  drop column poll_interval_seconds;
