-- migrate:up
-- Estimation questions (P3-W13-S03, §6.3, C-27, Q-P3-05): a number with a unit
-- instead of four options. The owner writes some in admin (Q-P3-05 (b)); those have no
-- moment or chapter, so their home is the source page they cite (AI-3: the URL, its
-- title and the quoted sentence in `citation`), and no model drafted them.
create type question_kind as enum ('choice', 'estimate');
alter table question
  add column kind question_kind not null default 'choice',
  add column answer double precision,
  add column unit text check (char_length(unit) between 1 and 40),
  add column source_url text check (source_url ~ '^https?://'),
  add column source_title text check (char_length(source_title) between 1 and 300),
  alter column options drop not null,
  alter column correct drop not null,
  alter column generator_model drop not null,
  alter column prompt_version drop not null,
  alter column content_hash drop not null,
  drop constraint question_one_home,
  add constraint question_one_home
    check (num_nonnulls(moment_id, book_chapter_id, source_url) = 1),
  add constraint question_shape check (
    (kind = 'choice' and options is not null and correct is not null
      and answer is null and unit is null)
    or (kind = 'estimate' and answer > 0 and answer < 'Infinity'
      and unit is not null and options is null and correct is null
      and validator_answer is null)
  ),
  -- Hand-written exactly when it has a source page: a title to show with it, no model.
  add constraint question_hand_written check (
    (source_url is null) = (source_title is null)
    and (source_url is null) = (generator_model is not null)
    and (generator_model is null) = (prompt_version is null)
    and (generator_model is null) = (content_hash is null)
  );

-- migrate:down
delete from question where kind = 'estimate' or source_url is not null;
alter table question
  drop constraint question_hand_written,
  drop constraint question_shape,
  drop constraint question_one_home,
  add constraint question_one_home check (num_nonnulls(moment_id, book_chapter_id) = 1),
  alter column content_hash set not null,
  alter column prompt_version set not null,
  alter column generator_model set not null,
  alter column correct set not null,
  alter column options set not null,
  drop column source_title,
  drop column source_url,
  drop column unit,
  drop column answer,
  drop column kind;
drop type question_kind;
