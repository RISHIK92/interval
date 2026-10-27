-- migrate:up
-- Spot checks (Q-2, §6.8, P2-W8-S03): each week a random 10% of the week's new live
-- questions, plus every flagged one, wait for an admin's Keep or Retire. Kept after the
-- decision as the record of what was checked.
create type review_reason as enum ('sample', 'flagged');
create type review_decision as enum ('keep', 'retire');

-- A question can be reviewed again (kept once, flagged later): one open review at a
-- time.
create table question_review (
  id bigint generated always as identity primary key,
  question_id bigint not null references question (id) on delete cascade,
  reason review_reason not null,
  queued_at timestamptz not null default now(),
  decision review_decision,
  decided_by text,
  decided_at timestamptz,
  check (
    (decision is null) = (decided_by is null)
    and (decision is null) = (decided_at is null)
  )
);

create unique index question_review_one_open on question_review (question_id)
  where decision is null;
create index question_review_by_question on question_review (question_id, reason);

-- migrate:down
drop table question_review;
drop type review_decision;
drop type review_reason;
