-- migrate:up
-- Exploration by Thompson sampling (REC-4, REC-3 novelty slots, P1-W4-S09). Each arm
-- (a topic the user didn't choose, or a source new to them) is Beta(1 + finished,
-- 1 + shown - finished), counted across all users (owner, 2026-10-26). Week 5's
-- reading slices record shown and finished; until then every arm is at its prior.
create table explore_arm_outcome (
  kind text not null check (kind in ('topic', 'source')),
  arm text not null,
  shown bigint not null default 0 check (shown >= 0),
  finished bigint not null default 0 check (finished between 0 and shown),
  primary key (kind, arm)
);

insert into ranking_config (key, value, note) values
  ('explore.share', 0.1, 'share of a user''s feed slots per chip given to exploration');

-- migrate:down
delete from ranking_config where key = 'explore.share';
drop table explore_arm_outcome;
