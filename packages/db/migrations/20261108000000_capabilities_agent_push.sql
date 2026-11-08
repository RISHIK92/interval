-- migrate:up
-- ADR-0036 (OPS-3; owner, 2026-11-08): the agent hook and web push get capabilities of
-- their own, checked where they are served. Added here, granted in the next migration:
-- a new enum value can't be used in the transaction that adds it.
alter type capability add value if not exists 'agent.hook';
alter type capability add value if not exists 'push.notify';

-- migrate:down
-- Postgres can't drop an enum value; the grants' migration removes their uses.
