-- migrate:up
-- Topic paths (§5F, Q-P2-22, Q-P2-24, P2-W10-S01): the model proposes a path's concepts
-- and orders them into sections by prerequisite; each section's sessions are moments
-- on its concepts. A proposal is a draft until the owner approves it (P2-W10-S02);
-- users only ever see live paths. A session goes with its moment when the moment is
-- deleted; a source whose rights are lowered or moments switched off keeps its
-- moments, so whatever reads paths re-checks each session's rights (ING-2).
alter type ai_feature add value if not exists 'paths';

create type path_status as enum ('draft', 'live', 'retired');

create table path (
  id bigint generated always as identity primary key,
  name text not null check (char_length(name) between 1 and 120),
  why text not null check (char_length(why) between 1 and 500),
  status path_status not null default 'draft',
  model text not null,
  prompt_version integer not null check (prompt_version >= 1),
  created_at timestamptz not null default now(),
  -- when the owner approved or retired it
  decided_at timestamptz
);

create table path_section (
  id bigint generated always as identity primary key,
  path_id bigint not null references path (id) on delete cascade,
  ordinal smallint not null check (ordinal >= 0),
  unique (path_id, ordinal)
);

create table path_section_concept (
  section_id bigint not null references path_section (id) on delete cascade,
  concept_id bigint not null references concept (id),
  primary key (section_id, concept_id)
);

create table path_session (
  section_id bigint not null references path_section (id) on delete cascade,
  ordinal smallint not null check (ordinal >= 0),
  moment_id bigint not null references moment (id) on delete cascade,
  primary key (section_id, ordinal)
);

-- migrate:down
drop table path_session;
drop table path_section_concept;
drop table path_section;
drop table path;
drop type path_status;
-- ai_feature keeps 'paths': Postgres can't drop an enum value.
