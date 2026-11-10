-- migrate:up
-- Voiced explainers (TTS-3, TTS-4, CACHE-4, P4-W22-S04): an approved script said once by
-- the chosen provider, cut into HLS in the public media bucket, with each word's time
-- beside it (TTS-3: captions and highlighting).
create table explainer_audio (
  id bigint generated always as identity primary key,
  explainer_id bigint not null unique references concept_explainer (id),
  provider text not null check (provider in ('elevenlabs', 'inworld', 'polly')),
  voice text not null,
  playlist_key text not null,
  duration_seconds numeric(8, 2) not null check (duration_seconds > 0),
  -- [{word, start, end}] in seconds, of the text as it was said.
  words jsonb not null check (jsonb_typeof(words) = 'array'),
  created_at timestamptz not null default now()
);

-- migrate:down
drop table explainer_audio;
