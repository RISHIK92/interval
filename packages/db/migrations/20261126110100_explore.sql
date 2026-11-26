-- migrate:up
-- ADR-0046: Explore's search, its gap card and "Ask anything".

-- Search (ADR-0011: Postgres full text, no new service). Only fields cards already show:
-- an item's title and author, and its stored excerpt, which the database already keeps
-- to excerpt sources (enforce_excerpt_rights, ING-2); a moment's title; a user's own
-- note. Never content_item_private_text. Source, concept and technology names are small
-- tables, matched as they're read.
alter table content_item add column search_vector tsvector generated always as (
  setweight(to_tsvector('english', title), 'A')
  || setweight(to_tsvector('english', coalesce(author, '')), 'B')
  || setweight(to_tsvector('english', coalesce(excerpt, '')), 'C')
) stored;
create index content_item_search on content_item using gin (search_vector);

alter table moment add column search_vector tsvector generated always as (
  to_tsvector('english', title)
) stored;
create index moment_search on moment using gin (search_vector);

alter table user_note add column search_vector tsvector generated always as (
  to_tsvector('english', body)
) stored;
create index user_note_search on user_note using gin (search_vector);

-- "Saved most this week" reads the last 7 days of saves.
create index user_save_recent on user_save (saved_at);

-- "A gap worth closing": dismissed once, never shown again for that concept.
create table explore_gap_dismissal (
  user_id text not null references app_user (id) on delete cascade,
  concept_id bigint not null references concept (id) on delete cascade,
  dismissed_at timestamptz not null default now(),
  primary key (user_id, concept_id)
);

-- Ask (AI-3): the question, and apart from it and from all source text, the answer.
-- Kept 30 days, then purged; the user may delete one sooner. The text never enters
-- events, ranking or inferred interests.
create table ask_question (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references app_user (id) on delete cascade,
  text text not null check (char_length(text) between 1 and 300),
  -- The prompt chip it was asked with, if any: it sets the level or the answer's form.
  chip text check (chip in ('compare', 'explain_new', 'interview_drill', 'my_stack')),
  -- LOAD-5: the browser's key, so a retried submit is the same question.
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 100),
  asked_at timestamptz not null default now(),
  -- "Ask a follow-up": the question it follows; its thread goes with it.
  follow_up_of uuid references ask_question (id) on delete cascade,
  unique (user_id, idempotency_key)
);
create index ask_question_user_day on ask_question (user_id, asked_at);
create index ask_question_follow_up on ask_question (follow_up_of)
  where follow_up_of is not null;
create index ask_question_purge on ask_question (asked_at);

create table ask_answer (
  question_id uuid primary key references ask_question (id) on delete cascade,
  -- answered: the model's answer, validated; nothing_found: no model was called;
  -- over_budget and unavailable: said to the user, never left waiting.
  outcome text not null
    check (outcome in ('answered', 'nothing_found', 'over_budget', 'unavailable')),
  text text check (char_length(text) <= 2000),
  -- [{passage, moment_id} | {passage, concept_id}]: what each cited passage was.
  citations jsonb not null default '[]',
  model text,
  prompt_version smallint,
  cost_usd numeric(12, 6),
  answered_at timestamptz not null default now(),
  check ((outcome = 'answered') = (text is not null)),
  check (outcome = 'answered' or citations = '[]'::jsonb)
);

-- OPS-3: the beta plan asks, at most 20 questions a day (ADR-0046). Guests have the
-- beta plan too, but Explore turns them to sign-up (ADR-0029: guests only play).
insert into plan_capability (plan_id, capability, limit_value) values
  ('beta', 'explore.ask', null),
  ('beta', 'explore.ask.daily', 20);

-- migrate:down
delete from user_capability where capability in ('explore.ask', 'explore.ask.daily');
delete from plan_capability where capability in ('explore.ask', 'explore.ask.daily');
drop table ask_answer;
drop table ask_question;
drop table explore_gap_dismissal;
drop index user_save_recent;
alter table user_note drop column search_vector;
alter table moment drop column search_vector;
alter table content_item drop column search_vector;
