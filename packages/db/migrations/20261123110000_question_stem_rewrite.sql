-- migrate:up
-- Stand-alone stems (owner, 2026-11-23; `rewrite-stems`): when a live question's stem was
-- last sent for a rewrite, whatever came of it. A limited rerun takes the never-tried
-- ones first and leaves a failed one alone for a while, so each run makes progress
-- instead of paying for the same oldest failures again.
alter table question add column stem_rewrite_tried_at timestamptz;

-- migrate:down
alter table question drop column stem_rewrite_tried_at;
