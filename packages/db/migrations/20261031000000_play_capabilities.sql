-- migrate:up
-- Quick games (§6.3, OPS-3, P3-W13-S01): one capability per game, so a plan can leave
-- one out. Their own migration: Postgres can't use an enum value in the transaction
-- that adds it. if not exists: values survive a rollback (see down).
alter type capability add value if not exists 'play.daily';
alter type capability add value if not exists 'play.sprint';
alter type capability add value if not exists 'play.estimation';
alter type capability add value if not exists 'play.live';

-- migrate:down
-- Postgres can't drop an enum value; 20261031000100's down removes every use of them.
