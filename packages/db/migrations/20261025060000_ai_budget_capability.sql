-- migrate:up
-- OPS-4, Q-P1-23: the per-user daily AI budget is a plan limit (OPS-3), in cents. Its
-- own migration: Postgres can't use an enum value in the transaction that adds it.
-- if not exists: the value survives a rollback (see down), so a re-run must not fail.
alter type capability add value if not exists 'ai.budget.daily_cents';

-- migrate:down
-- Postgres can't drop an enum value; 20261025060100's down removes every use of it.
