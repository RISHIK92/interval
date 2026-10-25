-- migrate:up
-- Guest-first onboarding (§5A, PER-1 explicit layer, PER-3, C-21, P1-W4-S01): one
-- screen, three fields. These are the user's explicit choices, which always win over
-- inferred interests and are never changed by feedback (PER-1). A guest's row carries
-- over when it becomes an account (same user id), and goes with the user.

-- The four launch topics (§2, C-32). concept.topic still checks the same list as text
-- (moving it to this type is a follow-up).
create type topic as enum ('system-design', 'databases', 'distributed-systems', 'backend');
-- Minutes (Q-P1-16): the default time chip.
create type break_length as enum ('1-3', '3-8', '8-15');

create table user_preferences (
  user_id text primary key references app_user (id) on delete cascade,
  topics topic[] not null check (cardinality(topics) between 1 and 4),
  level difficulty not null,
  break_length break_length not null,
  onboarded_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- migrate:down
drop table user_preferences;
drop type break_length;
drop type topic;
