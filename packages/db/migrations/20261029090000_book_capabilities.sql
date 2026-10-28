-- migrate:up
-- PDF books (§5F, OPS-3, Q-P2-34, P2-W11-S01): the beta plan's limits on books. Their
-- own migration: Postgres can't use an enum value in the transaction that adds it.
-- if not exists: values survive a rollback (see down), so a re-run must not fail.
alter type capability add value if not exists 'books.count';
alter type capability add value if not exists 'books.max_mb';
alter type capability add value if not exists 'books.max_pages';

-- migrate:down
-- Postgres can't drop an enum value; 20261029090100's down removes every use of them.
