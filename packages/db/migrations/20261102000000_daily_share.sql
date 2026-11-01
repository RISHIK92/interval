-- migrate:up
-- P3-W13-S06 (§6.3): a daily challenge result is shared by a public link. The id is
-- random, so a link can't be guessed from another (attempt ids count up). Every attempt
-- gets one, so no insert has to remember it; only a daily attempt's is ever served.
alter table quiz_attempt
  add column share_id uuid not null default gen_random_uuid() unique;

-- migrate:down
alter table quiz_attempt drop column share_id;
