-- migrate:up
-- The concept graph (DB-2, §3.1, Q-P1-04): concepts and typed edges in Postgres,
-- queried with recursive SQL. Loaded from the owner-approved seed file (Q-P1-03).
create type concept_edge_type as enum ('prerequisite_of', 'related_to', 'applied_in');

create table concept (
  id bigint generated always as identity primary key,
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null check (char_length(name) between 1 and 200),
  description text check (char_length(description) <= 500),
  -- The four launch topics (§2, C-32).
  topic text not null
    check (topic in ('system-design', 'databases', 'distributed-systems', 'backend')),
  created_at timestamptz not null default now(),
  -- Concepts are retired or merged, never deleted, so tags and learner state that
  -- reference them never dangle (Q-P1-04).
  retired_at timestamptz,
  merged_into bigint references concept (id),
  check (merged_into is null or retired_at is not null),
  check (merged_into <> id)
);

-- "from prerequisite_of to": from is learned first.
create table concept_edge (
  from_id bigint not null references concept (id),
  to_id bigint not null references concept (id),
  type concept_edge_type not null,
  primary key (from_id, to_id, type),
  check (from_id <> to_id)
);
create index concept_edge_to on concept_edge (to_id, type);

-- One row per approved graph change; the seed file's version (Q-P1-04).
create table graph_version (
  version integer primary key check (version >= 1),
  loaded_at timestamptz not null default now()
);

create function refuse_concept_delete() returns trigger language plpgsql as $$
begin
  raise exception 'concept % is retired, never deleted', old.slug;
end;
$$;

create trigger concept_never_deleted
  before delete on concept
  for each row execute function refuse_concept_delete();

-- Behind the seed loader's own check: "prerequisite of" stays acyclic.
create function refuse_prerequisite_cycle() returns trigger language plpgsql as $$
begin
  if new.type = 'prerequisite_of' and exists (
    with recursive reach(id) as (
      select new.to_id
      union
      select e.to_id from concept_edge e join reach r on e.from_id = r.id
      where e.type = 'prerequisite_of'
    )
    select 1 from reach where id = new.from_id
  ) then
    raise exception 'prerequisite cycle through concept %',
      (select slug from concept where id = new.from_id);
  end if;
  return new;
end;
$$;

create trigger concept_edge_acyclic
  before insert or update on concept_edge
  for each row execute function refuse_prerequisite_cycle();

-- An LLM drafts candidate concepts for the owner (Q-P1-03), costed like any call.
alter type ai_feature add value if not exists 'concept_drafting';

-- migrate:down
drop trigger concept_edge_acyclic on concept_edge;
drop function refuse_prerequisite_cycle();
drop trigger concept_never_deleted on concept;
drop function refuse_concept_delete();
drop table graph_version;
drop table concept_edge;
drop table concept;
drop type concept_edge_type;
-- ai_feature keeps 'concept_drafting': Postgres can't drop an enum value.
