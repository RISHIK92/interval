-- migrate:up
-- Concept explainers (§5G, AI-1, AI-3, AI-4, ING-2, OPS-4, ADR-0038, P4-W22-S01): one
-- script per concept, written once by EXPLAINER_MODEL from several full-text sources,
-- with citations. AI output, kept apart from source text; the owner approves or rejects
-- it at /admin/explainers before it is voiced.
create type explainer_status as enum ('pending', 'approved', 'rejected');

create table concept_explainer (
  id bigint generated always as identity primary key,
  concept_id bigint not null unique references concept (id),
  -- 60 to 120 seconds spoken (Q-P4-11): about 150 to 300 words.
  script text not null check (char_length(script) between 1 and 4000),
  -- [{moment_id, quote}]: each a sentence from a cited section (AI-3).
  citations jsonb not null check (jsonb_typeof(citations) = 'array'),
  generator_model text not null,
  prompt_version integer not null,
  status explainer_status not null default 'pending',
  decided_by text references app_user (id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  check ((status = 'pending') = (decided_at is null))
);

-- A concept tried without a script (too few sources with text, or a reply refused):
-- left alone for a while, so it neither takes every run's turn nor bills each time.
create table concept_explainer_attempt (
  concept_id bigint primary key references concept (id),
  outcome text not null check (outcome in ('skipped', 'refused')),
  tried_at timestamptz not null default now()
);

alter type ai_feature add value if not exists 'explainer';

-- migrate:down
drop table if exists concept_explainer_attempt;
drop table concept_explainer;
drop type explainer_status;
-- Postgres can't drop an enum value: 'explainer' stays in ai_feature (as earlier ones).
