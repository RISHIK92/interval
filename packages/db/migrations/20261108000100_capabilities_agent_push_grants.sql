-- migrate:up
-- ADR-0036: every current user keeps both (the beta plan), with no limit.
insert into plan_capability (plan_id, capability, limit_value) values
  ('beta', 'agent.hook', null),
  ('beta', 'push.notify', null);

-- migrate:down
delete from user_capability where capability in ('agent.hook', 'push.notify');
delete from plan_capability where capability in ('agent.hook', 'push.notify');
