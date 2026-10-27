-- migrate:up
-- Tagging v3 (2026-10-27): concepts carry aliases (abbreviations, other spellings)
-- and an embedding each, so a section's candidate concepts can be shortlisted before
-- the decision model is asked about them.
alter table concept add column aliases text[] not null default '{}';

create table concept_embedding (
  concept_id bigint not null references concept (id) on delete cascade,
  model text not null,
  -- The embedded text's hash: re-embedded only when the name or description changes.
  text_hash text not null,
  embedding vector(1024) not null,
  embedded_at timestamptz not null default now(),
  primary key (concept_id, model)
);

-- migrate:down
drop table concept_embedding;
alter table concept drop column aliases;
