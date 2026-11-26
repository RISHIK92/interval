-- migrate:up
-- ADR-0046 (OPS-3, OPS-4): Explore's Ask has a capability of its own and a daily count,
-- and spends from the AI budgets as a feature of its own. Its own migration: Postgres
-- can't use an enum value in the transaction that adds it. if not exists: the values
-- survive a rollback.
alter type capability add value if not exists 'explore.ask';
alter type capability add value if not exists 'explore.ask.daily';
alter type ai_feature add value if not exists 'ask';

-- migrate:down
-- Postgres can't drop an enum value; 20261126110100's down removes every use of them.
