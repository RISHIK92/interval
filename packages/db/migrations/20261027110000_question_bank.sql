-- migrate:up
-- The question bank (Q-1, §6.8, AI-3, P2-W8-S01): multiple-choice questions drafted
-- from a tagged moment by the question model, each citing its moment's text, kept
-- apart from that text (AI-3). Questions cascade with their moment, so they follow the
-- moment's rights (ING-2): a lowered profile purges moments and with them questions.
-- Statuses: pending (drafted, not yet validated), live, rejected (the validator
-- disagreed), flagged, retired.
alter type ai_feature add value if not exists 'questions';

create type question_status as enum ('pending', 'live', 'rejected', 'flagged', 'retired');

create table question (
  id bigint generated always as identity primary key,
  moment_id bigint not null references moment (id) on delete cascade,
  -- which of the moment's questions (Q-P2-08: 2 per moment)
  ordinal smallint not null check (ordinal >= 0),
  stem text not null check (char_length(stem) between 1 and 500),
  options text[] not null check (cardinality(options) = 4),
  correct smallint not null check (correct between 0 and 3),
  -- a verbatim quote of the moment's text, for validation and review only; users get
  -- the deep link, never the quote (Q-P2-12)
  citation text not null check (char_length(citation) between 1 and 300),
  status question_status not null default 'pending',
  generator_model text not null,
  prompt_version integer not null check (prompt_version >= 1),
  -- of the text and prompt the questions were drafted from: drafted once (AI-4)
  content_hash text not null,
  created_at timestamptz not null default now()
);

-- A redraft (new text, concepts or prompt) retires the moment's questions rather than
-- deleting them: what hangs off a question (validation, spot checks, answers) stays.
create unique index question_one_per_slot on question (moment_id, ordinal)
  where status <> 'retired';
create index question_status_created on question (status, created_at);

-- Drafting's retry state per moment (Q-P2-10): the attempt the newest retry carries
-- and when it is due. A delivery from an older attempt is a stale chain (a re-tag or a
-- second backfill while a retry waits) and is dropped; one long overdue means its
-- retry was lost, so a fresh start is taken.
create table question_drafting (
  moment_id bigint primary key references moment (id) on delete cascade,
  attempt integer not null check (attempt >= 1),
  retry_at timestamptz not null
);

-- The moment's concepts when the question was drafted (§3.1: every question tests
-- one or more concepts).
create table question_concept (
  question_id bigint not null references question (id) on delete cascade,
  concept_id bigint not null references concept (id),
  primary key (question_id, concept_id)
);

-- migrate:down
drop table question_drafting;
drop table question_concept;
drop table question;
drop type question_status;
-- ai_feature keeps 'questions': Postgres can't drop an enum value.
