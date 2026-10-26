-- migrate:up
-- Account first (ADR-0016, owner 2026-10-26): existing guests are deleted now, and no
-- new ones are made. Their rows go with them through the same cascades the guest purge
-- job relies on. Never deployed, so this touches only local data.
delete from app_user where is_anonymous;

-- migrate:down
-- Irreversible by the owner's choice: deleted guests can't be brought back.
select 1;
