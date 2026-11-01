-- migrate:up
-- The daily challenge (P3-W13-S05, §6.3, Q-P3-06, ADR-0031): one set of 5 a UTC day,
-- the same for everyone, picked the day before for the owner's review. A set the
-- owner hasn't approved by its day still runs, and its questions join the spot-check
-- queue (ADR-0031, amending Q-2).
create table daily_challenge (
  day date primary key,
  picked_at timestamptz not null default now(),
  approved_at timestamptz,
  published_unreviewed_at timestamptz,
  check (approved_at is null or published_unreviewed_at is null)
);

-- A question purged with its moment (ING-2) leaves its slot empty; the day's other
-- questions still run.
create table daily_challenge_question (
  day date not null references daily_challenge (day) on delete cascade,
  position smallint not null check (position between 0 and 4),
  question_id bigint not null references question (id) on delete cascade,
  primary key (day, position),
  unique (day, question_id)
);
create index daily_challenge_question_by_question on daily_challenge_question (question_id);

-- One attempt a day per player, finished or not (§6.3 "one attempt", LOAD-5).
alter table quiz_attempt
  add column daily_day date references daily_challenge (day),
  drop constraint quiz_attempt_shape,
  add constraint quiz_attempt_shape check (
    (daily_day is null and (
      (review and not sprint and content_item_id is null and moment_id is null
        and ends_at is null and path_section_id is null and book_chapter_id is null
        and checkpoint_size is null and checkpoint_passed is null)
      or (not review and not sprint and content_item_id is not null
        and ends_at is not null and path_section_id is null and book_chapter_id is null
        and checkpoint_size is null and checkpoint_passed is null)
      or (not review and not sprint and num_nonnulls(path_section_id, book_chapter_id) = 1
        and checkpoint_size is not null
        and content_item_id is null and moment_id is null and ends_at is not null)
      or (sprint and not review and ends_at is not null
        and content_item_id is null and moment_id is null
        and path_section_id is null and book_chapter_id is null
        and checkpoint_size is null and checkpoint_passed is null)
    ))
    or (daily_day is not null and not review and not sprint and ends_at is not null
      and content_item_id is null and moment_id is null
      and path_section_id is null and book_chapter_id is null
      and checkpoint_size is null and checkpoint_passed is null)
  );
create unique index quiz_attempt_one_daily on quiz_attempt (user_id, daily_day)
  where daily_day is not null;

-- ADR-0031: an auto-published set's questions, queued for the owner after the fact.
alter type review_reason add value 'daily';

-- The pick rule, in one place for the worker's pick and the admin's swap (ARCH-2).
-- Live questions of one kind that rounds may serve (ING-2: multiple choice as
-- quizzes' `LIVE`, estimates as `LIVE_ESTIMATE`), never a book chapter's; none in
-- a set within 30 days of the day (Q-P3-06, owner 2026-11-01); intermediate first,
-- then not yet levelled, then the rest.
create function daily_challenge_fit(p_day date, p_kind question_kind, p_except smallint)
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

-- The day's set, 3 multiple choice then 2 estimates (owner, 2026-11-01); an estimate
-- slot the bank can't fill takes multiple choice, and a small bank makes a short set.
-- False when the day already had one.
create function daily_challenge_pick(p_day date)
returns boolean
language plpgsql
as $$
declare
  want question_kind;
  found_id bigint;
  pos smallint := 0;
begin
  insert into daily_challenge (day) values (p_day) on conflict do nothing;
  if not found then
    return false;
  end if;
  foreach want in array array['choice', 'choice', 'choice', 'estimate', 'estimate']::question_kind[]
  loop
    found_id := coalesce(
      daily_challenge_fit(p_day, want, null),
      case when want = 'estimate' then daily_challenge_fit(p_day, 'choice', null) end
    );
    if found_id is not null then
      insert into daily_challenge_question (day, position, question_id)
      values (p_day, pos, found_id);
      pos := pos + 1;
    end if;
  end loop;
  return true;
end
$$;

-- The admin's swap: another question of the same kind by the same rule, only for a
-- day that hasn't started (UTC). False when the slot is empty, the day has started,
-- or nothing fits.
create function daily_challenge_swap(p_day date, p_position smallint)
returns boolean
language plpgsql
as $$
declare
  slot_kind question_kind;
  found_id bigint;
begin
  if p_day <= (now() at time zone 'utc')::date then
    return false;
  end if;
  -- One swap at a time per day, so two at once never pick the same question.
  perform 1 from daily_challenge where day = p_day for update;
  select q.kind into slot_kind
  from daily_challenge_question d
  join question q on q.id = d.question_id
  where d.day = p_day and d.position = p_position
  for update of d;
  if not found then
    return false;
  end if;
  found_id := daily_challenge_fit(p_day, slot_kind, p_position);
  if found_id is null then
    return false;
  end if;
  update daily_challenge_question set question_id = found_id
  where day = p_day and position = p_position;
  return true;
end
$$;

-- migrate:down
drop function daily_challenge_swap(date, smallint);
drop function daily_challenge_pick(date);
drop function daily_challenge_fit(date, question_kind, smallint);
-- An enum value can't be dropped: the type is made again without it.
delete from question_review where reason = 'daily';
alter type review_reason rename to review_reason_old;
create type review_reason as enum ('sample', 'flagged', 'anomaly');
alter table question_review
  alter column reason type review_reason using reason::text::review_reason;
drop type review_reason_old;
delete from quiz_attempt where daily_day is not null;
drop index quiz_attempt_one_daily;
alter table quiz_attempt
  drop constraint quiz_attempt_shape,
  add constraint quiz_attempt_shape check (
    (review and not sprint and content_item_id is null and moment_id is null
      and ends_at is null and path_section_id is null and book_chapter_id is null
      and checkpoint_size is null and checkpoint_passed is null)
    or (not review and not sprint and content_item_id is not null
      and ends_at is not null and path_section_id is null and book_chapter_id is null
      and checkpoint_size is null and checkpoint_passed is null)
    or (not review and not sprint and num_nonnulls(path_section_id, book_chapter_id) = 1
      and checkpoint_size is not null
      and content_item_id is null and moment_id is null and ends_at is not null)
    or (sprint and not review and ends_at is not null
      and content_item_id is null and moment_id is null
      and path_section_id is null and book_chapter_id is null
      and checkpoint_size is null and checkpoint_passed is null)
  ),
  drop column daily_day;
drop table daily_challenge_question;
drop table daily_challenge;
