-- migrate:up
-- The extension round (P5-W31-S02a; §6.5, Q-P5-15): revealed to every player at once,
-- 30 minutes in. Its statement and the extended interface must never be served before
-- the reveal: whatever reads these columns for a client gates them on the battle's
-- reveal time (W31-S02b). Its scenarios and results stay in the private bucket.
alter table lld_problem
  add column extension_statement text,
  add column extension_interface jsonb,
  add check ((extension_statement is null) = (extension_interface is null));

-- migrate:down
alter table lld_problem
  drop column extension_interface,
  drop column extension_statement;
