-- migrate:up
-- Review sessions (PER-2, §5I, Q-P2-17, P2-W9-S05): the Library's review queue asks one
-- live question per due concept, most overdue first, up to 10, untimed. A review is a
-- quiz attempt with no article and no clock; the concepts it set out to cover are kept
-- in order, so a refresh or a later visit continues the same list.
alter table quiz_attempt
  add column review boolean not null default false,
  alter column content_item_id drop not null,
  alter column ends_at drop not null,
  add constraint quiz_attempt_review_shape check (
    review = (content_item_id is null)
    and review = (ends_at is null)
    and (not review or moment_id is null)
  );

-- One running review per user: a double tap meets the same one (LOAD-5).
create unique index quiz_attempt_one_open_review on quiz_attempt (user_id)
  where review and finished_at is null;

create table quiz_attempt_concept (
  attempt_id bigint not null references quiz_attempt (id) on delete cascade,
  concept_id bigint not null references concept (id),
  ordinal smallint not null check (ordinal >= 0),
  primary key (attempt_id, concept_id),
  unique (attempt_id, ordinal)
);

-- migrate:down
drop table quiz_attempt_concept;
delete from quiz_attempt where review;
alter table quiz_attempt
  drop constraint quiz_attempt_review_shape,
  drop column review,
  alter column content_item_id set not null,
  alter column ends_at set not null;
