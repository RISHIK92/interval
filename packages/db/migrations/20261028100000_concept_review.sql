-- migrate:up
-- FSRS review cards (PER-2, Q-P2-16, P2-W9-S04): one per user and concept, created by
-- the first finished quiz that tested the concept and rated once per quiz after that.
-- The fields are ts-fsrs's card; the web app schedules (ARCH-2: implemented once). A
-- concept is due for review when `due` has passed; that is read from here, never
-- stored as a learner state, which quiz answers recompute (P2-W9-S03).
create table concept_review (
  user_id text not null references app_user (id) on delete cascade,
  concept_id bigint not null references concept (id),
  due timestamptz not null,
  stability double precision not null check (stability >= 0),
  difficulty double precision not null check (difficulty between 1 and 10),
  scheduled_days integer not null check (scheduled_days >= 0),
  learning_steps integer not null check (learning_steps >= 0),
  reps integer not null check (reps >= 1),
  lapses integer not null check (lapses >= 0),
  -- ts-fsrs State: 0 new, 1 learning, 2 review, 3 relearning
  state smallint not null check (state between 0 and 3),
  last_review timestamptz not null,
  primary key (user_id, concept_id)
);
create index concept_review_due on concept_review (user_id, due);

-- migrate:down
drop table concept_review;
