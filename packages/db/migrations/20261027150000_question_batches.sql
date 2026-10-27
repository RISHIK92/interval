-- migrate:up
-- Question batches (Q-P2-13, P2-W8-S05): drafting and validation sent through the
-- provider's batch API at half price, collected later. Each request is remembered
-- with what it was for, so results map back by custom_id; a moment or question in an
-- open (not yet closed) batch isn't sent again; a broken reply counts toward the
-- moment's cap.
create type question_batch_kind as enum ('draft', 'validate');

create table question_batch (
  id text primary key,  -- the provider's batch id
  kind question_batch_kind not null,
  model text not null,
  submitted_at timestamptz not null default now(),
  closed_at timestamptz,
  outcome text check (outcome in ('completed', 'failed')),
  cost_usd numeric(12, 6) check (cost_usd >= 0),
  check ((closed_at is null) = (outcome is null))
);

create index question_batch_open on question_batch (submitted_at) where closed_at is null;

create table question_batch_item (
  batch_id text not null references question_batch (id) on delete cascade,
  custom_id text not null,
  moment_id bigint references moment (id) on delete cascade,
  question_id bigint references question (id) on delete cascade,
  -- for a draft: the content hash its request was built from
  content_hash text,
  -- set when collected: saved or decided, broken (a reply that broke a rule), error
  -- (the provider failed it), skipped (its moment or question changed meanwhile)
  result text check (result in ('saved', 'decided', 'broken', 'error', 'skipped')),
  primary key (batch_id, custom_id),
  check ((moment_id is null) <> (question_id is null))
);

create index question_batch_item_moment on question_batch_item (moment_id);
create index question_batch_item_question on question_batch_item (question_id);

-- migrate:down
drop table question_batch_item;
drop table question_batch;
drop type question_batch_kind;
