-- migrate:up
-- ADR-0020: Groq is a second LLM provider; its calls are recorded like any other.
alter type ai_provider add value 'groq';

-- migrate:down
-- Postgres can't drop an enum value; rebuild the type without it (no Groq rows may
-- remain).
delete from ai_usage where provider = 'groq';
alter type ai_provider rename to ai_provider_old;
create type ai_provider as enum ('openrouter', 'voyage');
alter table ai_usage alter column provider type ai_provider
  using provider::text::ai_provider;
drop type ai_provider_old;
