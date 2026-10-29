-- migrate:up
-- GitHub projects (§5H, ADR-0024, P2-W12-S01): a signed-in user connects GitHub by
-- installing Interval's GitHub App (read-only Metadata and Contents) on the repositories
-- they pick. Only who they are on GitHub and which installations they can reach are
-- kept here; no token (installation tokens are minted per sync, S02).
create table github_account (
  user_id text primary key references app_user (id) on delete cascade,
  -- One Interval account per GitHub account: connecting it elsewhere moves it.
  github_user_id bigint not null unique,
  login text not null check (char_length(login) between 1 and 100),
  connected_at timestamptz not null default now()
);

create table github_installation (
  user_id text not null references github_account (user_id) on delete cascade,
  installation_id bigint not null,
  -- The account it's installed on: the user's own, or an organisation's.
  account_login text not null check (char_length(account_login) between 1 and 100),
  account_type text not null check (account_type in ('User', 'Organization')),
  primary key (user_id, installation_id)
);

-- migrate:down
drop table github_installation;
drop table github_account;
