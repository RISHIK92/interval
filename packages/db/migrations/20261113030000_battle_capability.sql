-- migrate:up
-- LLD battles (§6.5, OPS-3, P5-W31-S03): a capability of their own, so a plan can leave
-- them out. Its own migration: Postgres can't use an enum value in the transaction that
-- adds it. if not exists: the value survives a rollback (see down).
alter type capability add value if not exists 'play.battle';

-- migrate:down
-- Postgres can't drop an enum value; 20261113030100's down removes every use of it.
