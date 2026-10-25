-- migrate:up
-- Private beta (Q-P1-24): every user, guest or account, enters with an invite code that
-- sets their beta group.
create type beta_group as enum ('student', 'developer');

-- The one normaliser for invite codes, used by the worker (issue) and the web app
-- (redeem), so both languages agree on what a code is.
create function normalize_invite_code(raw text) returns text
  language sql immutable strict
  return upper(regexp_replace(raw, '[\s-]', '', 'g'));

create table invite_code (
  id bigint generated always as identity primary key,
  -- Normalised and at least 10 characters: hand-inserted short codes would be guessable.
  code text not null unique check (code = normalize_invite_code(code) and length(code) >= 10),
  beta_group beta_group not null,
  max_uses integer not null check (max_uses >= 1),
  used_count integer not null default 0 check (used_count >= 0 and used_count <= max_uses),
  expires_at timestamptz not null,
  note text,
  created_at timestamptz not null default now(),
  -- Target of app_user's composite key, so a user's group is always their code's group.
  unique (id, beta_group)
);

-- Better Auth 1.7.12 tables (anonymous plugin, email + password), snake_case; the auth
-- config maps model and field names (P1-W1-S10, S11).
create table app_user (
  id text primary key,
  name text not null,
  email text not null unique,
  email_verified boolean not null default false,
  image text,
  is_anonymous boolean not null default false,
  -- No user without a redeemed invite code, and the code sets the group (Q-P1-24).
  beta_group beta_group not null,
  invite_code_id bigint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (invite_code_id, beta_group) references invite_code (id, beta_group)
);
create index app_user_invite_code_id on app_user (invite_code_id);

create table auth_session (
  id text primary key,
  expires_at timestamptz not null,
  token text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null,
  ip_address text,
  user_agent text,
  user_id text not null references app_user (id) on delete cascade
);
create index auth_session_user_id on auth_session (user_id);

create table auth_account (
  id text primary key,
  account_id text not null,
  provider_id text not null,
  user_id text not null references app_user (id) on delete cascade,
  access_token text,
  refresh_token text,
  id_token text,
  access_token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  scope text,
  password text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null
);
create index auth_account_user_id on auth_account (user_id);

create table auth_verification (
  id text primary key,
  identifier text not null,
  value text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index auth_verification_identifier on auth_verification (identifier);

-- migrate:down
drop table auth_verification;
drop table auth_account;
drop table auth_session;
drop table app_user;
drop table invite_code;
drop function normalize_invite_code(text);
drop type beta_group;
