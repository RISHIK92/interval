-- migrate:up
-- ADR-0056 (owner, 2026-11-26): sign-up and guests need no invite code, and new users
-- have no beta group. A group still only ever comes from a redeemed code, so the two are
-- null together; the composite key to invite_code still ties a code's users to its group.
alter table app_user
  alter column beta_group drop not null,
  alter column invite_code_id drop not null,
  add constraint app_user_group_from_code check (
    (beta_group is null) = (invite_code_id is null)
  );

-- migrate:down
-- Fails while any user has no code: give those users a code (and its group) first.
alter table app_user
  drop constraint app_user_group_from_code,
  alter column beta_group set not null,
  alter column invite_code_id set not null;
