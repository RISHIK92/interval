-- migrate:up
-- The beta plan plays every quick game, with no limit (P3-W13-S01). Guests have the
-- beta plan too (ADR-0029).
insert into plan_capability (plan_id, capability, limit_value) values
  ('beta', 'play.daily', null),
  ('beta', 'play.sprint', null),
  ('beta', 'play.estimation', null),
  ('beta', 'play.live', null);

-- migrate:down
delete from user_capability
  where capability in ('play.daily', 'play.sprint', 'play.estimation', 'play.live');
delete from plan_capability
  where capability in ('play.daily', 'play.sprint', 'play.estimation', 'play.live');
