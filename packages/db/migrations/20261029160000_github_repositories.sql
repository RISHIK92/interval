-- migrate:up
-- GitHub projects (§5H, ADR-0024, P2-W12-S02): what the worker reads from a connected
-- user's repositories. Metadata and dependency names only, never file contents or code.
create type dependency_ecosystem as enum ('npm', 'pypi', 'go');

alter table github_account add column synced_at timestamptz;

create table github_repository (
  user_id text not null references github_account (user_id) on delete cascade,
  repo_id bigint not null,
  installation_id bigint not null,
  full_name text not null check (char_length(full_name) between 3 and 200),
  description text check (char_length(description) <= 500),
  languages text[] not null default '{}' check (cardinality(languages) <= 5),
  default_branch text not null,
  pushed_at timestamptz,
  synced_at timestamptz not null default now(),
  primary key (user_id, repo_id)
);

create table github_dependency (
  user_id text not null,
  repo_id bigint not null,
  ecosystem dependency_ecosystem not null,
  name text not null check (char_length(name) between 1 and 214),
  path text not null, -- the dependency file it came from
  dev boolean not null default false,
  primary key (user_id, repo_id, ecosystem, name),
  foreign key (user_id, repo_id) references github_repository (user_id, repo_id)
    on delete cascade
);

-- An organisation's installation reads every repository selected on it, some a given
-- member can't see: only these, read with the user's own token at connect, are theirs.
create table github_reachable_repository (
  user_id text not null references github_account (user_id) on delete cascade,
  installation_id bigint not null,
  repo_id bigint not null,
  primary key (user_id, installation_id, repo_id)
);

-- migrate:down
drop table github_reachable_repository;
drop table github_dependency;
drop table github_repository;
alter table github_account drop column synced_at;
drop type dependency_ecosystem;
