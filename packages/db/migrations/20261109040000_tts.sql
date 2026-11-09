-- migrate:up
-- TTS (TTS-1, OPS-4, Q-P4-07, P4-W22-S03): its providers' calls are recorded beside the
-- models' and count against the same daily budget (owner, 2026-11-09).
alter type ai_provider add value if not exists 'elevenlabs';
alter type ai_provider add value if not exists 'inworld';
alter type ai_provider add value if not exists 'polly';
alter type ai_feature add value if not exists 'tts';

-- The blind test (TTS-1): the same scripts voiced by each provider, unnamed (A, B, C) until
-- every script has the owner's pick.
create table tts_sample (
  id bigint generated always as identity primary key,
  run uuid not null,
  script_no integer not null check (script_no between 1 and 5),
  provider text not null check (provider in ('elevenlabs', 'inworld', 'polly')),
  voice_label text not null check (voice_label in ('A', 'B', 'C')),
  file_key text not null,
  created_at timestamptz not null default now(),
  picked_at timestamptz,
  picked_by text references app_user (id) on delete set null,
  unique (run, script_no, voice_label),
  unique (run, script_no, provider)
);

-- One pick a script.
create unique index tts_sample_one_pick on tts_sample (run, script_no)
  where picked_at is not null;

-- migrate:down
drop table tts_sample;
-- Postgres can't drop an enum value: the providers and 'tts' stay (as earlier ones).
