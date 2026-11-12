-- migrate:up
-- The beta plan plays LLD battles, with no limit (P5-W31-S03). Guests have the beta plan
-- too (ADR-0029).
insert into plan_capability (plan_id, capability, limit_value) values
  ('beta', 'play.battle', null);

-- migrate:down
delete from user_capability where capability = 'play.battle';
delete from plan_capability where capability = 'play.battle';
