-- migrate:up
-- ADR-0058 stage B (switch), the workers' half: the worker now writes per article.
-- Questions, their drafting state, batch items and path sessions get rows with an
-- article and no moment; the article's own vector gets its index. Moment-era rows are
-- kept as they are (stage C drops the moment schema). Writers set content_item_id (and
-- a question's article_ordinal) themselves; stage A's triggers still fill them for
-- rows written by moment.

-- A question's home is its article, a book chapter, or (hand-written) its source page.
-- A moment-era question keeps its moment beside its article.
alter table question drop constraint question_one_home;
alter table question add constraint question_one_home check (
  num_nonnulls(content_item_id, book_chapter_id, source_url) = 1
  and (moment_id is null or content_item_id is not null)
);

-- Retry state and the estimate's drafted hash, one row per article; the moment-era
-- rows stay keyed by their moment.
alter table question_drafting
  drop constraint question_drafting_pkey,
  alter column moment_id drop not null,
  add constraint question_drafting_home
    check (moment_id is not null or content_item_id is not null);
create unique index question_drafting_moment on question_drafting (moment_id)
  where moment_id is not null;
create unique index question_drafting_by_article on question_drafting (content_item_id)
  where moment_id is null;

alter table question_estimate_drafted
  drop constraint question_estimate_drafted_pkey,
  alter column moment_id drop not null,
  add constraint question_estimate_drafted_home
    check (moment_id is not null or content_item_id is not null);
create unique index question_estimate_drafted_moment
  on question_estimate_drafted (moment_id) where moment_id is not null;
create unique index question_estimate_drafted_by_article
  on question_estimate_drafted (content_item_id) where moment_id is null;

-- A batch item drafts for an article (a moment-era one for its moment) or validates a
-- question.
alter table question_batch_item drop constraint question_batch_item_check;
alter table question_batch_item add constraint question_batch_item_check check (
  num_nonnulls(moment_id, question_id) <= 1
  and (question_id is not null or content_item_id is not null)
);

-- Path sessions are articles; a moment-era session keeps its moment beside it. Two
-- moments of one article in one section become one session (ADR-0058: the first is
-- kept); the later one's user rows go with it (their key references it). Finishes are
-- the article's (user_article_finished), never a session's, so no progress is lost. A
-- user's own swaps that land on one article twice in a section keep the first too.
delete from path_session p
using path_session first
where first.section_id = p.section_id
  and first.content_item_id = p.content_item_id
  and first.ordinal < p.ordinal;
delete from user_path_session u
using user_path_session first
where first.user_id = u.user_id and first.section_id = u.section_id
  and first.content_item_id = u.content_item_id
  and first.ordinal < u.ordinal;
alter table path_session
  alter column moment_id drop not null,
  alter column content_item_id set not null;
alter table user_path_session
  alter column moment_id drop not null,
  alter column content_item_id set not null;

-- A section's sessions in a user's copy of a path, as user_path_sessions gives them,
-- by article: the swapped article while its rights allow it, else the approved one;
-- an article twice (a swap onto another session's) once, at its first place. One
-- definition for the web and the worker's path reminder (ARCH-2).
create function user_path_articles(p_user text, p_section bigint)
returns table (ordinal smallint, content_item_id bigint)
language sql stable as $$
  select distinct on (s.content_item_id) s.ordinal, s.content_item_id
  from (
  select ps.ordinal, coalesce(swapped.id, ps.content_item_id) as content_item_id
  from path_session ps
  left join lateral (
    select ci.id from user_path_session us
    join content_item ci on ci.id = us.content_item_id
    join source so on so.id = ci.source_id
    where us.user_id = p_user and us.section_id = ps.section_id
      and us.ordinal = ps.ordinal
      and so.rights_profile in ('full_text_internal', 'full_text_display')
      and ci.duplicate_of is null
  ) swapped on true
  where ps.section_id = p_section
  ) s
  order by s.content_item_id, s.ordinal
$$;

-- A question played in a match goes with its rounds when a rights purge deletes it
-- (ING-2), instead of refusing the purge: the round's text was derived from the
-- source's full text. A replay then has a round fewer.
alter table game_match_question
  drop constraint game_match_question_question_id_fkey,
  add constraint game_match_question_question_id_fkey
    foreign key (question_id) references question (id) on delete cascade;

-- "Continue reading" (ADR-0058) orders by the last open, not the first: the latest of
-- the article's moment opens and finishes, or its first open.
alter table user_article_opened
  add column last_opened_at timestamptz not null default now();
update user_article_opened a
set last_opened_at = greatest(a.opened_at, coalesce(r.at, a.opened_at))
from (
  select x.user_id, m.content_item_id, max(x.at) as at
  from (
    select user_id, moment_id, opened_at as at from user_moment_opened
    union all
    select user_id, moment_id, finished_at from user_moment_finished
  ) x
  join moment m on m.id = x.moment_id
  group by x.user_id, m.content_item_id
) r
where r.user_id = a.user_id and r.content_item_id = a.content_item_id;
update user_article_opened set last_opened_at = opened_at
where last_opened_at < opened_at;

create or replace function open_article_of_moment()
returns trigger
language plpgsql
as $$
declare
  at timestamptz;
begin
  -- Separate statements: each table's row has only its own timestamp column.
  if tg_table_name = 'user_moment_finished' then
    at := new.finished_at;
  else
    at := new.opened_at;
  end if;
  insert into user_article_opened (user_id, content_item_id, opened_at, last_opened_at)
  select new.user_id, m.content_item_id, at, at
  from moment m where m.id = new.moment_id
  on conflict (user_id, content_item_id) do update
    set opened_at = least(user_article_opened.opened_at, excluded.opened_at),
        last_opened_at = greatest(
          user_article_opened.last_opened_at, excluded.last_opened_at
        );
  return null;
end;
$$;

-- The article vectors' first reader (ranking's similarity, Ask), as stage A planned.
create index item_embedding_cosine on item_embedding
  using hnsw (embedding vector_cosine_ops);

-- ING-2: an article's vector and questions are derived from its full text, as its
-- moments' were (their rows went with the moments). Lowering a profile below full
-- text now also deletes the article's vector (so it's embedded again if the rights
-- come back), the questions drafted for the article (moment-era questions still go
-- with their moments) and its drafting state (so it's drafted again).
create or replace function purge_text_beyond_profile() returns trigger
language plpgsql as $$
begin
  if new.rights_profile not in ('full_text_internal', 'full_text_display') then
    delete from content_item_private_text pt
    using content_item ci
    where pt.content_item_id = ci.id and ci.source_id = new.id;
    delete from content_item_section cs
    using content_item ci
    where cs.content_item_id = ci.id and ci.source_id = new.id;
    update content_item set simhash = null
    where source_id = new.id and simhash is not null;
    delete from item_embedding ie
    using content_item ci
    where ie.content_item_id = ci.id and ci.source_id = new.id;
    delete from question q
    using content_item ci
    where q.content_item_id = ci.id and ci.source_id = new.id
      and q.moment_id is null;
    delete from question_estimate_drafted d
    using content_item ci
    where d.content_item_id = ci.id and ci.source_id = new.id
      and d.moment_id is null;
    delete from question_drafting d
    using content_item ci
    where d.content_item_id = ci.id and ci.source_id = new.id
      and d.moment_id is null;
  end if;
  if new.rights_profile <> 'excerpt' then
    update content_item set excerpt = null
    where source_id = new.id and excerpt is not null;
  end if;
  if not new.moments_enabled
    or new.rights_profile not in ('full_text_internal', 'full_text_display') then
    delete from moment m
    using content_item ci
    where m.content_item_id = ci.id and ci.source_id = new.id;
  end if;
  return new;
end;
$$;

-- migrate:down
create or replace function purge_text_beyond_profile() returns trigger
language plpgsql as $$
begin
  if new.rights_profile not in ('full_text_internal', 'full_text_display') then
    delete from content_item_private_text pt
    using content_item ci
    where pt.content_item_id = ci.id and ci.source_id = new.id;
    delete from content_item_section cs
    using content_item ci
    where cs.content_item_id = ci.id and ci.source_id = new.id;
    update content_item set simhash = null
    where source_id = new.id and simhash is not null;
  end if;
  if new.rights_profile <> 'excerpt' then
    update content_item set excerpt = null
    where source_id = new.id and excerpt is not null;
  end if;
  if not new.moments_enabled
    or new.rights_profile not in ('full_text_internal', 'full_text_display') then
    delete from moment m
    using content_item ci
    where m.content_item_id = ci.id and ci.source_id = new.id;
  end if;
  return new;
end;
$$;

create or replace function open_article_of_moment()
returns trigger
language plpgsql
as $$
declare
  first_at timestamptz;
begin
  -- Separate statements: each table's row has only its own timestamp column.
  if tg_table_name = 'user_moment_finished' then
    first_at := new.finished_at;
  else
    first_at := new.opened_at;
  end if;
  insert into user_article_opened (user_id, content_item_id, opened_at)
  select new.user_id, m.content_item_id, first_at
  from moment m where m.id = new.moment_id
  on conflict (user_id, content_item_id) do update
    set opened_at = least(user_article_opened.opened_at, excluded.opened_at);
  return null;
end;
$$;
alter table user_article_opened drop column last_opened_at;

drop index item_embedding_cosine;
drop function user_path_articles(text, bigint);

-- Rows written per article have no moment to go back to.
delete from user_path_session where moment_id is null;
delete from path_session where moment_id is null;
alter table user_path_session
  alter column content_item_id drop not null,
  alter column moment_id set not null;
alter table path_session
  alter column content_item_id drop not null,
  alter column moment_id set not null;

delete from question_batch_item where moment_id is null and question_id is null;
alter table question_batch_item drop constraint question_batch_item_check;
alter table question_batch_item add constraint question_batch_item_check
  check ((moment_id is null) <> (question_id is null));

delete from question_estimate_drafted where moment_id is null;
drop index question_estimate_drafted_by_article;
drop index question_estimate_drafted_moment;
alter table question_estimate_drafted
  drop constraint question_estimate_drafted_home,
  alter column moment_id set not null,
  add primary key (moment_id);

delete from question_drafting where moment_id is null;
drop index question_drafting_by_article;
drop index question_drafting_moment;
alter table question_drafting
  drop constraint question_drafting_home,
  alter column moment_id set not null,
  add primary key (moment_id);

delete from question where moment_id is null and content_item_id is not null;
alter table question drop constraint question_one_home;
alter table question add constraint question_one_home
  check (num_nonnulls(moment_id, book_chapter_id, source_url) = 1);

-- After the questions written per article are gone (their rounds with them); deleted
-- sessions and rounds aren't restored.
alter table game_match_question
  drop constraint game_match_question_question_id_fkey,
  add constraint game_match_question_question_id_fkey
    foreign key (question_id) references question (id);
