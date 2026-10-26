-- migrate:up
-- Learning goals (ADR-0015, accepted 2026-10-26): explicit choices (PER-1), picked in
-- onboarding and on Profile, that ranking scores through goal_match. Stack and book
-- goals are shown as coming soon until Phase 2 (GitHub, PDF books); "stay sharp" adds
-- no boost (owner, 2026-10-26).
create type learning_goal as enum (
  'system-design-interviews', 'stack-i-use', 'finish-that-book', 'stay-sharp'
);

-- One to four goals, as topics are (ADR-0015: "a non-empty array"). Rows made before
-- this get "stay sharp", which adds no boost; new rows must say.
alter table user_preferences
  add column goals learning_goal[] not null default '{stay-sharp}'
    check (cardinality(goals) between 1 and 4);
alter table user_preferences alter column goals drop default;

-- The curated concepts each goal points ranking at (PER-4's pattern). Slugs, not a
-- foreign key: a fresh database migrates before load-concepts fills the graph, and
-- ranking joins on slug. Owner-approved 2026-10-26; change it with a new migration.
create table goal_concept (
  goal learning_goal not null,
  concept_slug text not null,
  primary key (goal, concept_slug)
);

insert into goal_concept (goal, concept_slug)
select 'system-design-interviews', slug
from unnest(array[
  -- system design
  'latency-and-throughput', 'tail-latency', 'load-balancing', 'horizontal-scaling',
  'stateless-services', 'cdn', 'back-of-the-envelope-estimation', 'capacity-planning',
  'sharding', 'event-driven-architecture', 'graceful-degradation', 'circuit-breakers',
  'blue-green-deployment', 'feature-flags',
  -- distributed systems
  'cap-theorem', 'replication', 'consistency-models', 'partitioning',
  'consistent-hashing', 'quorums',
  -- databases
  'indexes', 'isolation-levels',
  -- backend
  'caching', 'rate-limiting'
]) as slug;

insert into ranking_config (key, value, note) values
  ('weight.goal_match', 0.8, 'the item has a concept from one of the user''s goals');

-- migrate:down
delete from ranking_config where key = 'weight.goal_match';
drop table goal_concept;
alter table user_preferences drop column goals;
drop type learning_goal;
