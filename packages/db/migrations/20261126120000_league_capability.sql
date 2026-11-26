-- migrate:up
-- ADR-0045 (OPS-3, ADR-0036): weekly leagues have a capability of their own. Its own
-- migration: Postgres can't use an enum value in the transaction that adds it. if not
-- exists: the value survives a rollback.
alter type capability add value if not exists 'play.league';

-- migrate:down
-- Postgres can't drop an enum value; 20261126120100's down removes every use of it.
