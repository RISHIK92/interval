-- migrate:up
-- The curated technology table (PER-4, §5H, P2-W12-S03): dependencies in connected
-- repositories resolve to technologies by package name, and technologies to concepts.
-- The seed (workers/jobs/seeds/technologies.yaml) is the owner's; an LLM suggests
-- additions, which the owner accepts or rejects (they then live here, source
-- 'suggestion', and a seed reload leaves them alone).
create type technology_source as enum ('seed', 'suggestion');
-- Who put a package or a concept on a technology: a seed reload replaces only the
-- seed's own, so an accepted suggestion on a seed technology survives it.
create table technology (
  id bigint generated always as identity primary key,
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null check (char_length(name) between 1 and 100),
  source technology_source not null,
  retired_at timestamptz
);

-- A package name, or (prefix) the start of one: an npm scope, a Go module path whose
-- /vN suffix varies.
create table technology_package (
  ecosystem dependency_ecosystem not null,
  pattern text not null check (char_length(pattern) between 1 and 214),
  prefix boolean not null default false,
  technology_id bigint not null references technology (id) on delete cascade,
  origin technology_source not null,
  primary key (ecosystem, pattern, prefix)
);

create table technology_concept (
  technology_id bigint not null references technology (id) on delete cascade,
  concept_id bigint not null references concept (id) on delete cascade,
  origin technology_source not null,
  primary key (technology_id, concept_id)
);

-- AI output, kept apart until the owner decides (AI-3). One per package, ever: a
-- rejected one isn't asked again.
-- skipped: nothing worth mapping (said, or no known concept named); unreadable: the
-- reply broke the rules. Either way the package isn't asked about again.
create type suggestion_status as enum (
  'pending', 'accepted', 'rejected', 'skipped', 'unreadable'
);
create table technology_suggestion (
  id bigint generated always as identity primary key,
  ecosystem dependency_ecosystem not null,
  package text not null,
  users integer not null check (users >= 0), -- connected users using it, when asked
  name text,
  slug text,
  concepts text[] not null default '{}',
  model text not null,
  status suggestion_status not null default 'pending',
  decided_by text references app_user (id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  unique (ecosystem, package),
  check ((status in ('skipped', 'unreadable')) = (slug is null)),
  check ((status in ('accepted', 'rejected')) = (decided_at is not null))
);

alter type ai_feature add value if not exists 'technologies';

-- Each stored dependency's technology: an exact package first, else the longest
-- prefix; a retired technology matches nothing.
create view github_dependency_technology as
select d.user_id, d.repo_id, d.ecosystem, d.name, d.dev, m.technology_id
from github_dependency d
cross join lateral (
  select p.technology_id from technology_package p
  join technology t on t.id = p.technology_id and t.retired_at is null
  where p.ecosystem = d.ecosystem
    and ((not p.prefix and p.pattern = d.name)
      or (p.prefix and starts_with(d.name, p.pattern)))
  order by p.prefix, char_length(p.pattern) desc
  limit 1
) m;

-- Stored dependencies no live technology claims and never suggested, by how many
-- connected users use them: what the suggestions ask about and the admin page lists.
-- Only names valid in their ecosystem (no backticks, spaces or newlines to smuggle
-- into a prompt).
create view unclaimed_dependency as
select d.ecosystem, d.name as package, count(distinct d.user_id)::int as users,
  exists (
    select 1 from technology_suggestion s
    where s.ecosystem = d.ecosystem and s.package = d.name
  ) as asked
from github_dependency d
where d.name ~ '^[A-Za-z0-9@][A-Za-z0-9@/._~-]*$'
  and not exists (
    select 1 from github_dependency_technology t
    where t.user_id = d.user_id and t.repo_id = d.repo_id
      and t.ecosystem = d.ecosystem and t.name = d.name
  )
group by d.ecosystem, d.name;

-- A user's technologies, each concept they map to, and the repositories behind them.
create function user_technology_concepts(p_user_id text)
returns table (
  technology_id bigint,
  technology text,
  concept_id bigint,
  repositories text[]
)
language sql stable
as $$
  select t.id, t.name, tc.concept_id,
    array_agg(distinct r.full_name order by r.full_name)
  from github_dependency_technology dt
  join technology t on t.id = dt.technology_id
  join technology_concept tc on tc.technology_id = t.id
  join concept c on c.id = tc.concept_id and c.retired_at is null
  join github_repository r on r.user_id = dt.user_id and r.repo_id = dt.repo_id
  where dt.user_id = p_user_id
  group by t.id, t.name, tc.concept_id
$$;

-- migrate:down
drop function user_technology_concepts(text);
drop view unclaimed_dependency;
drop view github_dependency_technology;
drop table technology_suggestion;
drop type suggestion_status;
drop table technology_concept;
drop table technology_package;
drop table technology;
drop type technology_source;
-- ai_feature keeps 'technologies': Postgres can't drop an enum value.
