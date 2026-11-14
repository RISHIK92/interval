-- migrate:up
-- The beta plan practises HLD, with no limit (P6-W39, ADR-0042 PROPOSED). Guests have
-- the beta plan too (ADR-0029).
insert into plan_capability (plan_id, capability, limit_value) values
  ('beta', 'play.hld', null);

-- migrate:down
delete from user_capability where capability = 'play.hld';
delete from plan_capability where capability = 'play.hld';
