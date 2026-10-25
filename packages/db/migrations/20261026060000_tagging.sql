-- migrate:up
-- Concept tagging and difficulty (AI-2..AI-5, Q-P1-10, P1-W3-S02). AI output is stored
-- apart from source text, with the model and prompt version that produced it (AI-3).
-- Tags reference concepts, which are never deleted, so retired ones stay readable.
create type difficulty as enum ('beginner', 'intermediate', 'advanced');

-- One row per tagged item: generate once per item (AI-4); a new prompt version
-- re-tags.
create table item_tagging (
  content_item_id bigint primary key references content_item (id) on delete cascade,
  difficulty difficulty not null,
  model text not null,
  prompt_version integer not null check (prompt_version >= 1),
  tagged_at timestamptz not null default now()
);

create table item_concept (
  content_item_id bigint not null references item_tagging (content_item_id)
    on delete cascade,
  concept_id bigint not null references concept (id),
  primary key (content_item_id, concept_id)
);

create table moment_tagging (
  moment_id bigint primary key references moment (id) on delete cascade,
  difficulty difficulty not null
);

create table moment_concept (
  moment_id bigint not null references moment_tagging (moment_id) on delete cascade,
  concept_id bigint not null references concept (id),
  primary key (moment_id, concept_id)
);
create index moment_concept_concept on moment_concept (concept_id);
create index item_concept_concept on item_concept (concept_id);

-- migrate:down
drop table moment_concept;
drop table moment_tagging;
drop table item_concept;
drop table item_tagging;
drop type difficulty;
