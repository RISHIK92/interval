-- migrate:up
-- Captions (TTS-3, P4-W23-S03): the script's own words, each timed by what was said for
-- it, made when the explainer is voiced (a dictionary term said as several words is one
-- caption again). No explainer is voiced yet, so no row needs one made afterwards.
alter table explainer_audio
  add column captions jsonb not null default '[]'
    check (jsonb_typeof(captions) = 'array');
alter table explainer_audio alter column captions drop default;

-- migrate:down
alter table explainer_audio drop column captions;
