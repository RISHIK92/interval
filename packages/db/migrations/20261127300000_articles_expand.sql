-- migrate:up
-- ADR-0058 stage A (expand): every row that hangs off a moment gets an article-level home
-- beside it, copied now. Nothing is dropped and no existing column changes meaning, so
-- today's code keeps working; stage B switches readers and writers over, stage C drops
-- the moment schema. The owner's rule: no model output (questions, explainers, tags,
-- probabilities, decisions, embeddings) is lost, so each has its article copy here.
--
-- Today's writers still insert by moment only. Until stage C, triggers fill the article
-- columns from the moment so rows written between the stages are never missing them.

-- A row's article, from its moment: on insert when not given, and again when an update
-- moves the row to another moment (a path swap rewrites user_path_session.moment_id).
create function fill_content_item_from_moment()
returns trigger
language plpgsql
as $$
begin
  if new.moment_id is not null then
    if tg_op = 'INSERT' then
      if new.content_item_id is null then
        new.content_item_id := (select content_item_id from moment where id = new.moment_id);
      end if;
    elsif new.moment_id is distinct from old.moment_id
      and new.content_item_id is not distinct from old.content_item_id then
      new.content_item_id := (select content_item_id from moment where id = new.moment_id);
    end if;
  end if;
  return new;
end;
$$;

-- Questions: their article, and a slot per article and kind. The slots are renumbered in
-- moment order, then the question's own order, so the one-per-slot rule holds once the
-- moment is gone. Retired questions keep a slot too, so every row's slot is unique.
alter table question
  add column content_item_id bigint references content_item (id) on delete cascade,
  add column article_ordinal integer check (article_ordinal >= 0);

update question q
set content_item_id = n.content_item_id, article_ordinal = n.article_ordinal
from (
  select q2.id, m.content_item_id,
         (row_number() over (
            partition by m.content_item_id, q2.kind
            order by m.ordinal, q2.ordinal, q2.id
          ) - 1)::integer as article_ordinal
  from question q2
  join moment m on m.id = q2.moment_id
) n
where n.id = q.id;

alter table question
  add constraint question_article_slot
    check ((content_item_id is null) = (article_ordinal is null));

create unique index question_one_per_article_slot
  on question (content_item_id, kind, article_ordinal)
  where content_item_id is not null;

-- The next free slot of the article and kind. The advisory lock serializes writers of one
-- article, so two drafts saved at once never take the same slot. It assumes READ
-- COMMITTED (every writer's level): each statement after the lock sees the slots the
-- previous holder committed; under a snapshot taken earlier, a clash fails on the unique
-- index rather than saving a duplicate. The locks can't cycle: the pipeline saves one
-- moment, so one article, per transaction (Questions.save, save_estimate), and batch
-- collection, which saves many in one, runs one at a time under its 'question-batches'
-- session lock; the owner's estimates have no moment and take none.
create function fill_question_article()
returns trigger
language plpgsql
as $$
begin
  if new.moment_id is not null then
    if tg_op = 'INSERT' then
      if new.content_item_id is null then
        new.content_item_id := (select content_item_id from moment where id = new.moment_id);
      end if;
    elsif new.moment_id is distinct from old.moment_id
      and new.content_item_id is not distinct from old.content_item_id then
      new.content_item_id := (select content_item_id from moment where id = new.moment_id);
    end if;
  end if;
  if new.content_item_id is null then
    new.article_ordinal := null;
  elsif new.article_ordinal is null
    or (tg_op = 'UPDATE'
        and (new.content_item_id is distinct from old.content_item_id
             or new.kind is distinct from old.kind)
        and new.article_ordinal is not distinct from old.article_ordinal) then
    perform pg_advisory_xact_lock(hashtext('question-article-slot:' || new.content_item_id));
    new.article_ordinal := (
      select coalesce(max(article_ordinal) + 1, 0) from question
      where content_item_id = new.content_item_id and kind = new.kind
    );
  end if;
  return new;
end;
$$;

create trigger question_article
  before insert or update on question
  for each row execute function fill_question_article();

-- Drafting state moves to the article with its questions.
alter table question_drafting
  add column content_item_id bigint references content_item (id) on delete cascade;
update question_drafting d set content_item_id = m.content_item_id
from moment m where m.id = d.moment_id;
create trigger question_drafting_article
  before insert or update on question_drafting
  for each row execute function fill_content_item_from_moment();

alter table question_estimate_drafted
  add column content_item_id bigint references content_item (id) on delete cascade;
update question_estimate_drafted d set content_item_id = m.content_item_id
from moment m where m.id = d.moment_id;
create trigger question_estimate_drafted_article
  before insert or update on question_estimate_drafted
  for each row execute function fill_content_item_from_moment();

-- A batch item drafts for a moment or validates a question: its article is either's.
alter table question_batch_item
  add column content_item_id bigint references content_item (id) on delete cascade;
update question_batch_item b
set content_item_id = coalesce(
  (select m.content_item_id from moment m where m.id = b.moment_id),
  (select q.content_item_id from question q where q.id = b.question_id)
);
create index question_batch_item_article on question_batch_item (content_item_id);

create function fill_question_batch_item_article()
returns trigger
language plpgsql
as $$
begin
  if new.content_item_id is null then
    new.content_item_id := coalesce(
      (select content_item_id from moment where id = new.moment_id),
      (select content_item_id from question where id = new.question_id)
    );
  end if;
  return new;
end;
$$;

create trigger question_batch_item_article
  before insert on question_batch_item
  for each row execute function fill_question_batch_item_article();

-- Path sessions point at the moment's article.
alter table path_session
  add column content_item_id bigint references content_item (id) on delete cascade;
update path_session p set content_item_id = m.content_item_id
from moment m where m.id = p.moment_id;
create trigger path_session_article
  before insert or update on path_session
  for each row execute function fill_content_item_from_moment();

alter table user_path_session
  add column content_item_id bigint references content_item (id) on delete cascade;
update user_path_session p set content_item_id = m.content_item_id
from moment m where m.id = p.moment_id;
create trigger user_path_session_article
  before insert or update on user_path_session
  for each row execute function fill_content_item_from_moment();

-- The article's embedding: the mean of its moments' (pgvector's avg), per model. The row
-- itself keeps its meaning, "embedded in full by this model" (the worker's completion
-- mark), so no row is added here; the vector is filled when the worker adds it.
-- The vector is derived from full text, like the moments' (ING-2): it follows them, so
-- when a rights purge deletes the moments it is recomputed without them, to null.
-- Its HNSW index comes with stage B, the first reader.
alter table item_embedding add column embedding vector(1024);

-- Latent race: two transactions embedding moments of one article at once each average
-- what their own snapshot sees, so the later commit can miss the other's moment. Today
-- one unit of work embeds an article's moments (Embeddings.save) and the queue's
-- idempotency key runs it once; stage B writes the article's vector itself.

create function refresh_item_embedding(p_item bigint)
returns void
language sql
as $$
  update item_embedding ie
  set embedding = (
    select avg(e.embedding) from moment_embedding e
    join moment m on m.id = e.moment_id
    where m.content_item_id = ie.content_item_id and e.model = ie.model
  )
  where ie.content_item_id = p_item;
$$;

update item_embedding ie
set embedding = a.embedding
from (
  select m.content_item_id, e.model, avg(e.embedding) as embedding
  from moment_embedding e
  join moment m on m.id = e.moment_id
  group by m.content_item_id, e.model
) a
where a.content_item_id = ie.content_item_id and a.model = ie.model;

create function fill_item_embedding()
returns trigger
language plpgsql
as $$
begin
  if new.embedding is null then
    new.embedding := (
      select avg(e.embedding) from moment_embedding e
      join moment m on m.id = e.moment_id
      where m.content_item_id = new.content_item_id and e.model = new.model
    );
  end if;
  return new;
end;
$$;

create trigger item_embedding_mean
  before insert on item_embedding
  for each row execute function fill_item_embedding();

-- After a moment's embedding changes. A delete cascaded from the moment finds no moment
-- here; the moment's own trigger below covers it.
create function item_embedding_follow_moment_embedding()
returns trigger
language plpgsql
as $$
begin
  if tg_op <> 'INSERT' then
    perform refresh_item_embedding(m.content_item_id)
    from moment m where m.id = old.moment_id;
  end if;
  if tg_op = 'INSERT' or (tg_op = 'UPDATE' and new.moment_id <> old.moment_id) then
    perform refresh_item_embedding(m.content_item_id)
    from moment m where m.id = new.moment_id;
  end if;
  return null;
end;
$$;

create trigger moment_embedding_item_mean
  after insert or update or delete on moment_embedding
  for each row execute function item_embedding_follow_moment_embedding();

create function item_embedding_follow_moment()
returns trigger
language plpgsql
as $$
begin
  perform refresh_item_embedding(old.content_item_id);
  return null;
end;
$$;

create trigger moment_item_embedding_mean
  after delete on moment
  for each row execute function item_embedding_follow_moment();

-- Tagging: item_decision and item_concept_probability hold the title/summary pass, which
-- the rollup reads under its own cut-off (tagging_rollup.py), and whose content_hash
-- skips asking again. Merged into those rows, the moments' answers would change today's
-- tags and the next tag pass would ask again and replace them. So the moments' answers
-- are copied per article under their own key, 'moments:<model>', which today's code
-- never reads: difficulty the median of the moments' (as the rollup takes it), each
-- concept's highest probability, the hash over the moments' hashes in order.
-- Stage C refolds them (moments written meanwhile) into the article's own rows, keeping
-- the higher probability. item_concept is the rollup's output, not the model's, and is
-- rebuilt from these answers; merging moment_concept in now would change today's tags
-- and break its five-concept cap.
insert into item_decision (content_item_id, model, content_hash, difficulty, decided_at)
select m.content_item_id, 'moments:' || d.model,
       md5(string_agg(d.content_hash, ',' order by m.ordinal)),
       percentile_cont(0.5) within group (order by d.difficulty),
       max(d.decided_at)
from moment_decision d
join moment m on m.id = d.moment_id
group by m.content_item_id, d.model
on conflict (content_item_id, model) do nothing;

insert into item_concept_probability (content_item_id, model, concept_id, probability)
select m.content_item_id, 'moments:' || p.model, p.concept_id, max(p.probability)
from moment_concept_probability p
join moment m on m.id = p.moment_id
group by m.content_item_id, p.model, p.concept_id
on conflict (content_item_id, model, concept_id)
  do update set probability = greatest(
    item_concept_probability.probability, excluded.probability
  );

-- Explainer citations name the cited moment's article beside the moment (AI-3: each
-- still cites its passage). A citation whose moment is already gone keeps only its id.
-- No trigger: today's writer stores exactly what it was given (its tests say so), so
-- stage C runs this again for explainers written meanwhile.
-- Ask answers need nothing: each citation of a reading already carries its item_id.
update concept_explainer x
set citations = (
  select jsonb_agg(
    case
      when c.e ? 'content_item_id' or m.id is null then c.e
      else c.e || jsonb_build_object('content_item_id', m.content_item_id)
    end
    order by c.o
  )
  from jsonb_array_elements(x.citations) with ordinality c(e, o)
  left join moment m on m.id = case
    when c.e ->> 'moment_id' ~ '^[0-9]+$' then (c.e ->> 'moment_id')::bigint
  end
)
where x.citations <> '[]'::jsonb;

-- tag_override rows for a heading stay as they are: the feed, the article's concepts and
-- the review page read the whole-article ('') row today, so a copy would change them.
-- Stage C folds the section rows into it once no reader applies them per section.

-- Opened articles: an article counts as opened from its first opened or finished moment.
-- Completion stays user_article_finished's.
create table user_article_opened (
  user_id text not null references app_user (id) on delete cascade,
  content_item_id bigint not null references content_item (id) on delete cascade,
  opened_at timestamptz not null default now(),
  primary key (user_id, content_item_id)
);

insert into user_article_opened (user_id, content_item_id, opened_at)
select r.user_id, m.content_item_id, min(r.at)
from (
  select user_id, moment_id, opened_at as at from user_moment_opened
  union all
  select user_id, moment_id, finished_at from user_moment_finished
) r
join moment m on m.id = r.moment_id
group by r.user_id, m.content_item_id;

create function open_article_of_moment()
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

create trigger user_moment_opened_article
  after insert on user_moment_opened
  for each row execute function open_article_of_moment();
create trigger user_moment_finished_article
  after insert on user_moment_finished
  for each row execute function open_article_of_moment();

-- migrate:down
drop trigger user_moment_finished_article on user_moment_finished;
drop trigger user_moment_opened_article on user_moment_opened;
drop function open_article_of_moment();
drop table user_article_opened;

update concept_explainer
set citations = (
  select coalesce(
    jsonb_agg(
      case when jsonb_typeof(c.e) = 'object' then c.e - 'content_item_id' else c.e end
      order by c.o
    ),
    '[]'::jsonb
  )
  from jsonb_array_elements(citations) with ordinality c(e, o)
)
where citations <> '[]'::jsonb;

-- Cascades to their item_concept_probability rows.
delete from item_decision where model like 'moments:%';

drop trigger moment_item_embedding_mean on moment;
drop function item_embedding_follow_moment();
drop trigger moment_embedding_item_mean on moment_embedding;
drop function item_embedding_follow_moment_embedding();
drop trigger item_embedding_mean on item_embedding;
drop function fill_item_embedding();
drop function refresh_item_embedding(bigint);
alter table item_embedding drop column embedding;

drop trigger user_path_session_article on user_path_session;
alter table user_path_session drop column content_item_id;
drop trigger path_session_article on path_session;
alter table path_session drop column content_item_id;

drop trigger question_batch_item_article on question_batch_item;
drop function fill_question_batch_item_article();
alter table question_batch_item drop column content_item_id;

drop trigger question_estimate_drafted_article on question_estimate_drafted;
alter table question_estimate_drafted drop column content_item_id;
drop trigger question_drafting_article on question_drafting;
alter table question_drafting drop column content_item_id;

drop trigger question_article on question;
drop function fill_question_article();
alter table question drop column article_ordinal, drop column content_item_id;

drop function fill_content_item_from_moment();
