-- migrate:up
-- ADR-0021: Google's Gemini API is a third LLM provider; its calls are recorded too.
alter type ai_provider add value 'google';

-- migrate:down
-- Postgres can't drop an enum value; rebuild the type without it (no Google rows may
-- remain).
delete from ai_usage where provider = 'google';
alter type ai_provider rename to ai_provider_old;
create type ai_provider as enum ('openrouter', 'voyage', 'groq');
alter table ai_usage alter column provider type ai_provider
  using provider::text::ai_provider;
drop type ai_provider_old;
