-- migrate:up
-- ADR-0048 (Q-WD-28): LLD practice is a practice battle on the game server. Each problem
-- is in one pool, practice or battle; a practice problem has its topic group and its
-- concepts, and is never the AI mode.
alter table lld_problem
  add column pool text not null default 'battle' check (pool in ('practice', 'battle')),
  add column topic text check (
    topic in ('oop-basics', 'relationships', 'principles', 'solid', 'creational',
              'structural', 'behavioural', 'systems')
  ),
  add column concepts text[] not null default '{}',
  add constraint lld_problem_practice_topic_check check ((pool = 'practice') = (topic is not null)),
  add constraint lld_problem_practice_mode_check check (pool = 'battle' or battle_mode = 'human');

-- A practice session is a match of its own mode, on its problem, always unrated.
alter table game_match
  drop constraint game_match_mode_check,
  add constraint game_match_mode_check
    check (mode in ('sprint', 'fastest_finger', 'battle', 'practice')),
  drop constraint game_match_battle_problem_check,
  add constraint game_match_battle_problem_check
    check ((mode in ('battle', 'practice')) = (problem_slug is not null)),
  add constraint game_match_practice_unrated_check check (mode <> 'practice' or unrated);

-- The player's code per problem and language, autosaved by the web app. `version` counts
-- saves, so a stale tab's save is refused, as hld_practice_design does.
create table lld_practice_code (
  user_id text not null references app_user (id) on delete cascade,
  problem_slug text not null references lld_problem (slug),
  language text not null check (length(language) between 1 and 20),
  code text not null check (octet_length(code) <= 262144),
  version integer not null check (version > 0),
  saved_at timestamptz not null default now(),
  primary key (user_id, problem_slug, language)
);

-- The player's best judged Submit per problem, kept by the worker from the game server's
-- progress messages: per-layer counts only (LLDQ-4), never code. `submits` counts every
-- judged Submit once (lld_practice_counted). Messages arrive late, out of order and more
-- than once, so the best is the greatest points seen, whatever order they came in.
create table lld_practice_best (
  user_id text not null references app_user (id) on delete cascade,
  problem_slug text not null references lld_problem (slug),
  points integer not null check (points between 0 and 1000),
  visible_passed integer not null check (visible_passed >= 0),
  visible_total integer not null check (visible_total >= visible_passed),
  hidden_passed integer not null check (hidden_passed >= 0),
  hidden_total integer not null check (hidden_total >= hidden_passed),
  concurrency_passed integer not null check (concurrency_passed >= 0),
  concurrency_total integer not null check (concurrency_total >= concurrency_passed),
  extension_passed integer not null check (extension_passed >= 0),
  extension_total integer not null check (extension_total >= extension_passed),
  language text not null check (length(language) between 1 and 20),
  achieved_at timestamptz not null,
  submits integer not null check (submits > 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, problem_slug)
);

-- Each judged Submit the worker has counted, by its match and the game server's sequence
-- number in that match (LOAD-5): a repeat finds its row and counts nothing.
create table lld_practice_counted (
  match_id uuid not null references game_match (id) on delete cascade,
  seq integer not null check (seq > 0),
  primary key (match_id, seq)
);

-- migrate:down
drop table lld_practice_counted;
drop table lld_practice_best;
drop table lld_practice_code;
delete from game_match where mode = 'practice';
alter table game_match
  drop constraint game_match_practice_unrated_check,
  drop constraint game_match_battle_problem_check,
  add constraint game_match_battle_problem_check
    check ((mode = 'battle') = (problem_slug is not null)),
  drop constraint game_match_mode_check,
  add constraint game_match_mode_check check (mode in ('sprint', 'fastest_finger', 'battle'));
alter table lld_problem
  drop constraint lld_problem_practice_mode_check,
  drop constraint lld_problem_practice_topic_check,
  drop column concepts,
  drop column topic,
  drop column pool;
