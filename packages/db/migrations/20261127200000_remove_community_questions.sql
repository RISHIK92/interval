-- migrate:up
-- ADR-0057 (owner, 2026-11-27): community questions are dropped from scope. Merged
-- migrations never change (ADR-0002), so this undoes 20261127100100 going forward, as
-- its own down did. The enum values 20261127100000 added stay: Postgres can't drop one,
-- and nothing uses them.
delete from user_capability
  where capability in ('questions.submit', 'questions.submit.daily');
delete from plan_capability
  where capability in ('questions.submit', 'questions.submit.daily');
-- Their reviews ('community', 'approve', 'reject') and answers go with them.
delete from question where submission_key is not null;
create or replace function daily_challenge_fit(
  p_day date, p_kind question_kind, p_except smallint
)
returns bigint
language sql volatile
as $$
  select q.id
  from question q
  where q.status = 'live' and q.kind = p_kind
    and (
      (q.kind = 'estimate' and q.source_url is not null)
      or exists (
        select 1 from moment m
        join content_item ci on ci.id = m.content_item_id
        join source s on s.id = ci.source_id
         and s.moments_enabled
         and s.rights_profile in ('full_text_internal', 'full_text_display')
        where m.id = q.moment_id
          and (q.kind = 'choice' or ci.link_broken_at is null)
      )
    )
    and not exists (
      select 1 from daily_challenge_question d
      where d.question_id = q.id and d.day between p_day - 30 and p_day + 30
    )
    -- 5 different concepts: none the day's other questions test.
    and not exists (
      select 1 from daily_challenge_question d
      join question_concept other on other.question_id = d.question_id
      join question_concept mine on mine.concept_id = other.concept_id
      where d.day = p_day and d.position is distinct from p_except
        and mine.question_id = q.id
    )
  order by case when q.difficulty = 'intermediate' then 0
                when q.difficulty is null then 1 else 2 end,
           random()
  limit 1
$$;
drop index question_author_day;
drop index question_submission;
drop index question_community_slot;
drop index question_one_per_slot;
create unique index question_one_per_slot on question (moment_id, kind, ordinal)
  where status <> 'retired';
alter table question
  drop constraint question_community,
  drop constraint question_hand_written,
  drop constraint question_one_origin,
  drop column rejected_because,
  drop column submission_key,
  drop column author_user_id,
  add constraint question_hand_written check (
    (source_url is null) = (source_title is null)
    and (source_url is null) = (generator_model is not null)
    and (generator_model is null) = (prompt_version is null)
    and (generator_model is null) = (content_hash is null)
  );

-- migrate:down
-- Back to 20261127100100's shape.
-- Q-P7-05 (owner, 2026-11-27), §6.8: a question a player with a verified email writes
-- at the end of a section they opened: a stem, 4 options, the key and a quote from the
-- section, on that section's concepts. It waits pending for the second model's check,
-- then for the owner's approval (question_review, reason 'community'); only then is it
-- live. It's anonymous to players: the author is kept for the owner and the daily count.
alter table question
  -- Owner, 2026-11-27: an author who leaves leaves the question, authorless, with
  -- other players' answers and its review history; it then counts toward no one.
  add column author_user_id text references app_user (id) on delete set null,
  -- LOAD-5: the browser's key, so a retried submit is the same question. Never
  -- cleared, so it marks a community question once its author is gone too: every
  -- reader tells one apart by `submission_key is not null`.
  add column submission_key text
    check (char_length(submission_key) between 1 and 100),
  -- Why a community question was rejected, for its author's page: its quote isn't
  -- the section's words, it refers to its source (the stand-alone rule, owner
  -- 2026-11-23), the second model chose another answer, or the owner rejected it.
  add column rejected_because text
    check (rejected_because in ('not_quoted', 'not_stand_alone', 'check', 'owner')),
  drop constraint question_hand_written,
  -- Exactly one origin: a model drafted it, the owner wrote it from a source page
  -- (P3-W13-S03), or a player wrote it.
  add constraint question_one_origin
    check (num_nonnulls(generator_model, source_url, submission_key) = 1),
  add constraint question_hand_written check (
    (source_url is null) = (source_title is null)
    and (generator_model is null) = (prompt_version is null)
    and (generator_model is null) = (content_hash is null)
  ),
  -- A section's multiple-choice question (question_one_home leaves it no other home);
  -- only a community question has an author or a reason it was rejected.
  add constraint question_community check (
    (submission_key is null or (moment_id is not null and kind = 'choice'))
    and (author_user_id is null or submission_key is not null)
    and (rejected_because is null
      or (submission_key is not null and status = 'rejected'))
  );

-- A moment's drafted slots stay the model's: a redraft retires and renumbers its own
-- questions from 0 and must never meet a player's. Community questions are numbered
-- apart, in submission order (0, 1, ...) per section, retired or not.
drop index question_one_per_slot;
create unique index question_one_per_slot on question (moment_id, kind, ordinal)
  where status <> 'retired' and submission_key is null;
create unique index question_community_slot on question (moment_id, ordinal)
  where submission_key is not null;
create unique index question_submission on question (author_user_id, submission_key)
  where author_user_id is not null;
-- At most questions.submit.daily a UTC day; also the author's cascade.
create index question_author_day on question (author_user_id, created_at)
  where author_user_id is not null;

-- Community questions serve in practice only (Test 60s and reviews, Q-P7-05), never the
-- daily challenge; until W51 they serve nowhere.
create or replace function daily_challenge_fit(
  p_day date, p_kind question_kind, p_except smallint
)
returns bigint
language sql volatile
as $$
  select q.id
  from question q
  where q.status = 'live' and q.kind = p_kind and q.submission_key is null
    and (
      (q.kind = 'estimate' and q.source_url is not null)
      or exists (
        select 1 from moment m
        join content_item ci on ci.id = m.content_item_id
        join source s on s.id = ci.source_id
         and s.moments_enabled
         and s.rights_profile in ('full_text_internal', 'full_text_display')
        where m.id = q.moment_id
          and (q.kind = 'choice' or ci.link_broken_at is null)
      )
    )
    and not exists (
      select 1 from daily_challenge_question d
      where d.question_id = q.id and d.day between p_day - 30 and p_day + 30
    )
    -- 5 different concepts: none the day's other questions test.
    and not exists (
      select 1 from daily_challenge_question d
      join question_concept other on other.question_id = d.question_id
      join question_concept mine on mine.concept_id = other.concept_id
      where d.day = p_day and d.position is distinct from p_except
        and mine.question_id = q.id
    )
  order by case when q.difficulty = 'intermediate' then 0
                when q.difficulty is null then 1 else 2 end,
           random()
  limit 1
$$;

-- OPS-3: the beta plan submits, at most 3 a day (owner, 2026-11-27). Guests have the
-- beta plan too, but can't submit (ADR-0029: guests only play; Q-P7-05).
insert into plan_capability (plan_id, capability, limit_value) values
  ('beta', 'questions.submit', null),
  ('beta', 'questions.submit.daily', 3);

