-- migrate:up
-- Rule-based ranking (REC-2, REC-3, Q-P1-13, P1-W4-S03): every weight in one table,
-- which the owner tunes in Week 6. The values below are overnight placeholders
-- (2026-10-26), flagged in docs/progress.md.
create table ranking_config (
  key text primary key,
  -- Finite and not negative: numeric holds NaN and Infinity, which would scramble every
  -- score, and a negative weight or penalty would reverse what its rule means.
  value numeric not null
    check (value >= 0 and value < 'Infinity' and value <> 'NaN'),
  note text not null
);

insert into ranking_config (key, value, note) values
  ('weight.topic_match', 1.0, 'the item is on one of the user''s chosen topics'),
  ('weight.level_fit', 0.6, 'difficulty against the user''s level: 1 same, 0.5 one apart'),
  ('weight.quality', 0.4, 'the source''s quality score, 1-5 scaled to 0-1'),
  ('weight.freshness', 0.5, 'exp(-age / half-life)'),
  ('weight.time_fit', 0.7, 'fits the user''s break length'),
  ('penalty.less_like_this', 1.0, 'the user said Less like this to the item'),
  ('penalty.not_interested_concepts', 0.8,
   'share of the item''s concepts in items the user said Not interested to'),
  ('freshness.half_life_days', 14, 'days for freshness to halve'),
  ('mmr.lambda', 0.7, 'MMR: 1 is pure score, 0 is pure diversity'),
  ('cap.per_source', 4, 'at most this many moments from one source in a feed');

-- migrate:down
drop table ranking_config;
