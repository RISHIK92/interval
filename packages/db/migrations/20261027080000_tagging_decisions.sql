-- migrate:up
-- Tagging v3 (2026-10-27): a decision model's raw answers per moment and per article,
-- kept so the cut-offs that turn them into tags can be retuned without asking again.
-- content_hash is the hash of what was asked about: an unchanged moment isn't asked
-- twice by the same model.
create table moment_decision (
  moment_id bigint not null references moment (id) on delete cascade,
  model text not null,
  content_hash text not null,
  -- the score, 0 beginner to 2 advanced
  difficulty double precision not null check (difficulty between 0 and 2),
  decided_at timestamptz not null default now(),
  primary key (moment_id, model)
);

create table moment_concept_probability (
  moment_id bigint not null,
  model text not null,
  concept_id bigint not null references concept (id) on delete cascade,
  probability double precision not null check (probability between 0 and 1),
  primary key (moment_id, model, concept_id),
  foreign key (moment_id, model) references moment_decision (moment_id, model)
    on delete cascade
);

create table item_decision (
  content_item_id bigint not null references content_item (id) on delete cascade,
  model text not null,
  content_hash text not null,
  -- of the title/summary (or excerpt), 0 to 2
  difficulty double precision not null check (difficulty between 0 and 2),
  decided_at timestamptz not null default now(),
  primary key (content_item_id, model)
);

create table item_concept_probability (
  content_item_id bigint not null,
  model text not null,
  concept_id bigint not null references concept (id) on delete cascade,
  probability double precision not null check (probability between 0 and 1),
  primary key (content_item_id, model, concept_id),
  foreign key (content_item_id, model) references item_decision (content_item_id, model)
    on delete cascade
);

-- migrate:down
drop table item_concept_probability;
drop table item_decision;
drop table moment_concept_probability;
drop table moment_decision;
