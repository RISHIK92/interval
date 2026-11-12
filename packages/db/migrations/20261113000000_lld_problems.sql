-- migrate:up
-- LLD battle problems (P5-W31-S01; LLDQ-1 to LLDQ-4, DB-6), loaded from
-- problems/lld/<slug>/ by `pnpm problems:load`. A row holds what a player may see:
-- the statement, the interface and the visible scenarios with their expected
-- results. The hidden and concurrency scenarios, and every expected result, are in
-- the private bucket at private_key (LLDQ-4: hidden tests never reach the client).
create type lld_difficulty as enum ('easy', 'medium', 'hard');

create table lld_problem (
  slug text primary key check (slug ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$' and length(slug) <= 48),
  title text not null check (length(title) between 3 and 80),
  difficulty lld_difficulty not null,
  statement text not null,
  interface jsonb not null,
  checks jsonb not null default '[]',
  limits jsonb not null,
  -- [{scenario, results}], in the problem's own order.
  visible jsonb not null check (jsonb_typeof(visible) = 'array'),
  -- Content-addressed, so a row never points at a file still being written.
  private_key text not null,
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  -- Gone from problems/lld; kept, as battles will refer to it.
  retired_at timestamptz,
  loaded_at timestamptz not null default now(),
  check (private_key = 'lld/problems/' || slug || '/' || content_hash || '.json')
);

-- migrate:down
drop table lld_problem;
drop type lld_difficulty;
