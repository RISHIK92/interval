-- migrate:up
-- ADR-0050 / Q-WD-31 (owner, 2026-11-23): chat, checkout, metrics-ingestion and
-- rate-limiter are battle-only now, so their saved practice designs are unreachable; the
-- owner chose to delete them rather than keep or show them.
delete from hld_practice_design
where problem_slug in ('chat', 'checkout', 'metrics-ingestion', 'rate-limiter');

-- migrate:down
-- Deleted designs can't be restored; nothing to undo in the schema.
select 1;
