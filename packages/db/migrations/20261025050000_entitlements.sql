-- migrate:up
-- Entitlements (OPS-3, Q-P1-22): features check capabilities, so plans can be added later
-- through configuration. The enum is the one list of capabilities; the codegen turns it
-- into the TS and Python types (ADR-0002), so an unknown capability fails typecheck.
create type capability as enum ('feed.read', 'admin.review', 'ai.notes.daily');

create table plan (
  id text primary key,
  name text not null
);

-- limit_value: null means no limit; a capability without a row is not granted.
create table plan_capability (
  plan_id text not null references plan (id),
  capability capability not null,
  limit_value integer check (limit_value >= 0),
  primary key (plan_id, capability)
);

insert into plan (id, name) values ('beta', 'Beta');
-- ai.notes.daily = 20 is a placeholder (owner, 2026-10-25); W4-S06 and S16 revisit it.
insert into plan_capability (plan_id, capability, limit_value) values
  ('beta', 'feed.read', null),
  ('beta', 'ai.notes.daily', 20);

-- Every user has a plan. Better Auth's inserts don't name this column, so the default
-- applies to guests and accounts alike.
alter table app_user add column plan_id text not null default 'beta' references plan (id);

-- Grants on top of the plan, for one person (Q-P1-29: admin for the owner and invited
-- reviewers). No limits here: limits come from plans.
create table user_capability (
  user_id text not null references app_user (id) on delete cascade,
  capability capability not null,
  granted_at timestamptz not null default now(),
  primary key (user_id, capability)
);

-- A grant has no limit, so a capability that any plan limits (an OPS-4 cost) comes only
-- from a plan; otherwise a single grant would mean unlimited use.
create function refuse_limited_grant() returns trigger
  language plpgsql
as $$
begin
  if exists (
    select 1 from plan_capability
    where capability = new.capability and limit_value is not null
  ) then
    raise exception 'capability % has a limit; grant it through a plan', new.capability;
  end if;
  return new;
end;
$$;

create trigger user_capability_unlimited_only
  before insert or update on user_capability
  for each row execute function refuse_limited_grant();

-- What each user may do: the plan's capabilities, plus grants the plan doesn't already
-- give. The plan's row wins where both exist, so its limit holds. Both languages read
-- this view; the rule lives only here.
create view user_entitlement as
select u.id as user_id, pc.capability, pc.limit_value
from app_user u
join plan_capability pc on pc.plan_id = u.plan_id
union all
select uc.user_id, uc.capability, null::integer as limit_value
from user_capability uc
join app_user u on u.id = uc.user_id
where not exists (
  select 1 from plan_capability pc
  where pc.plan_id = u.plan_id and pc.capability = uc.capability
);

-- migrate:down
drop view user_entitlement;
drop table user_capability;
drop function refuse_limited_grant;
alter table app_user drop column plan_id;
drop table plan_capability;
drop table plan;
drop type capability;
