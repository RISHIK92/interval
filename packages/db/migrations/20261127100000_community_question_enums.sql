-- migrate:up
-- Q-P7-05 (owner, 2026-11-27), §6.8: community questions. Submitting is a capability
-- of its own with a daily count (OPS-3, as ADR-0046's explore.ask), a submission the
-- second model agrees with waits in the owner's queue for its own reason, and the
-- owner approves or rejects it. Their own migration: Postgres can't use an enum value
-- in the transaction that adds it. if not exists: the values survive a rollback.
alter type capability add value if not exists 'questions.submit';
alter type capability add value if not exists 'questions.submit.daily';
alter type review_reason add value if not exists 'community';
alter type review_decision add value if not exists 'approve';
alter type review_decision add value if not exists 'reject';

-- migrate:down
-- Postgres can't drop an enum value; 20261127100100's down removes every use of them.
