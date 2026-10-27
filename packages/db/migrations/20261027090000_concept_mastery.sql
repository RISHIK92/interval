-- migrate:up
-- Concept mastery (PER-2, §3.1, Q-P2-02, Q-P2-03, P2-W7-S01): one row per user and
-- concept they have evidence for; no row means unseen. Reading raises the probability
-- weakly and its state to explored, never further; quizzes and checkpoints (Weeks 9-10)
-- set practiced and mastered, and FSRS sets due for review. Kept apart from explicit
-- choices and inferred interests, which never overwrite it (PER-1).
create type learner_state as enum ('explored', 'practiced', 'mastered', 'due_for_review');

create table concept_mastery (
  user_id text not null references app_user (id) on delete cascade,
  concept_id bigint not null references concept (id),
  probability double precision not null check (probability between 0 and 1),
  state learner_state not null,
  evidence_count integer not null check (evidence_count >= 1),
  updated_at timestamptz not null default now(),
  primary key (user_id, concept_id)
);

-- migrate:down
drop table concept_mastery;
drop type learner_state;
