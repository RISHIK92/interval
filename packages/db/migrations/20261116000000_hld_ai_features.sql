-- migrate:up
-- P6-W41 (CANVAS-6, OPS-4, Q-P6-05): the HLD judge and coach spend from the AI budgets
-- as features of their own. Its own migration: Postgres can't use an enum value in the
-- transaction that adds it. if not exists: the value survives a rollback.
alter type ai_feature add value if not exists 'hld_judge';
alter type ai_feature add value if not exists 'hld_coach';

-- migrate:down
-- Postgres can't drop an enum value; nothing uses these until 20261116000100.
