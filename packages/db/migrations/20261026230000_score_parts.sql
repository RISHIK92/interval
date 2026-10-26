-- migrate:up
-- Ranking inspection (REC-2, P1-W6-S01): how each entry's score was made, by rule, so
-- the owner can tune the weights in ranking_config. Written by the worker at
-- recompute: {"values": {signal: v}, "weights": {signal: w}, "weighted": {signal: v * w},
-- "penalty": p}, with the weights it was scored with (the table may change since).
-- Null for entries stored before this, until the user's next recompute.
alter table user_feed_entry add column score_parts jsonb;

-- migrate:down
alter table user_feed_entry drop column score_parts;
