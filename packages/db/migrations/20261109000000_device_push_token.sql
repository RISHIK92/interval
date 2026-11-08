-- migrate:up
-- P4-W19-S04a (Q-P4-03; owner, 2026-11-07): a phone's push token (APNs on iOS, FCM on
-- Android), registered by the app when its user turns notifications on. The worker sends
-- straight to Apple's and Google's services (S04b). A token belongs to one user: a phone
-- signed in as someone else moves it.
create table device_push_token (
  id bigint generated always as identity primary key,
  user_id text not null references app_user (id) on delete cascade,
  platform text not null check (platform in ('ios', 'android')),
  token text not null unique
    check (char_length(token) between 1 and 4096 and token ~ '^[A-Za-z0-9:_-]+$'),
  created_at timestamptz not null default now()
);
create index device_push_token_user on device_push_token (user_id);

-- migrate:down
drop table device_push_token;
