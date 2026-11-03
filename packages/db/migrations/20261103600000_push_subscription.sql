-- migrate:up
-- P3-W17-S05b (§7, Q-P3-18; owner, 2026-11-03): a browser that asked for the agent
-- hook's notifications (web push). The endpoint is the push service's address for that
-- browser; p256dh and auth are its keys (base64url), for RFC 8291 encryption.
create table push_subscription (
  id bigint generated always as identity primary key,
  user_id text not null references app_user (id) on delete cascade,
  endpoint text not null unique
    check (endpoint ~ '^https://' and char_length(endpoint) <= 2000),
  p256dh text not null check (p256dh ~ '^[A-Za-z0-9_-]{87}$'),
  auth text not null check (auth ~ '^[A-Za-z0-9_-]{22}$'),
  created_at timestamptz not null default now()
);
create index push_subscription_user on push_subscription (user_id);

-- migrate:down
drop table push_subscription;
