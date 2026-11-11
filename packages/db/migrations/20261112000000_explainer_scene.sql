-- migrate:up
-- Visual explainers (TTS-5, DB-6, P4.5-W26-S01; owner, Q-P4.5-03): one scene timeline
-- an explainer, drafted by EXPLAINER_MODEL from its script and captions, its JSON in
-- the public media bucket (DB-6, CACHE-4), kept pending until the owner approves it.
create table explainer_scene (
  id bigint generated always as identity primary key,
  explainer_id bigint not null unique references concept_explainer (id)
    on delete cascade,
  scene_key text not null check (scene_key like 'media/explainers/%.json'),
  generator_model text not null,
  prompt_version integer not null,
  status explainer_status not null default 'pending',
  decided_by text references app_user (id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  check ((status = 'pending') = (decided_at is null))
);

-- An explainer whose draft was refused twice: left alone for a while, so it neither
-- takes every run's turn nor bills each time (as concept_explainer_attempt).
create table explainer_scene_attempt (
  explainer_id bigint primary key references concept_explainer (id) on delete cascade,
  tried_at timestamptz not null default now()
);

-- OPS-4: their spend apart from the scripts'.
alter type ai_feature add value if not exists 'scenes';

-- migrate:down
drop table explainer_scene_attempt;
drop table explainer_scene;
-- Postgres can't drop an enum value: 'scenes' stays in ai_feature (as earlier ones).
