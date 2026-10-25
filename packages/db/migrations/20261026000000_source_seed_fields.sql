-- migrate:up
-- The seed list file's remaining fields (P1-W2-S01).
-- quality_score: the owner's 1-5 rating (Q-P1-37); null until set.
alter table source add column quality_score smallint
  check (quality_score between 1 and 5);
-- topics: as written in the seed file; W3-S01 maps them to the concept graph.
alter table source add column topics text[] not null default '{}';
-- A source removed from the seed file is deactivated, never deleted: polling (W2-S03)
-- skips it, and the items already ingested stay in the feed.
alter table source add column active boolean not null default true;

-- migrate:down
alter table source drop column active;
alter table source drop column topics;
alter table source drop column quality_score;
