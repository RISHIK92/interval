-- migrate:up
-- P3-W14-S05 (§6.7, Q-P3-11; owner, 2026-11-02): every account has a username, chosen
-- once and never changed, shown on boards in place of its name; players follow each
-- other by username, one way, with no accept step. Accounts only (ADR-0029).
create table player_username (
  user_id text primary key references app_user (id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9_]{3,20}$'),
  -- Found in people search unless the player turns it off; following by the exact
  -- username works either way.
  searchable boolean not null default true,
  created_at timestamptz not null default now()
);

create table follow (
  follower_id text not null references app_user (id) on delete cascade,
  followee_id text not null references app_user (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, followee_id),
  check (follower_id <> followee_id)
);
-- A player's followers, which they see in full (owner, 2026-11-02).
create index follow_followee on follow (followee_id);

-- migrate:down
drop table follow;
drop table player_username;
