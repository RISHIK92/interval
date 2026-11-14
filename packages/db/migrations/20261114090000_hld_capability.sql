-- migrate:up
-- HLD practice and battles (§6.4, OPS-3, P6-W39, ADR-0042 PROPOSED): a capability of
-- their own, so a plan can leave them out. Its own migration: Postgres can't use an enum
-- value in the transaction that adds it. if not exists: the value survives a rollback.
alter type capability add value if not exists 'play.hld';

-- migrate:down
-- Postgres can't drop an enum value; 20261114090100's down removes every use of it.
