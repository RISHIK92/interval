-- migrate:up
-- AI cost budgets (OPS-4, LOAD-6, Q-P1-23, ADR-0010 item 6). Every model call goes
-- through the worker's ai/gateway.py (ADR-0008), which writes one ai_usage row per call
-- and refuses calls once today's spend reaches the budget.

-- Placeholders (owner, 2026-10-25): $0.50 per user per day; the owner sets real values
-- before the beta. The entitlement trigger already refuses granting it per user.
insert into plan_capability (plan_id, capability, limit_value)
values ('beta', 'ai.budget.daily_cents', 50);

-- Offline jobs (no user) share one global daily budget: $5 per day for now.
create table ai_budget (
  scope text primary key check (scope = 'global'),
  daily_cents integer not null check (daily_cents >= 0)
);
insert into ai_budget (scope, daily_cents) values ('global', 500);

-- The slices that add model calls extend these.
create type ai_feature as enum ('tagging', 'notes', 'embeddings');
create type ai_provider as enum ('openrouter', 'voyage');

create table ai_usage (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  user_id text references app_user (id) on delete set null,
  -- Set at insert, never changed: a deleted user's user_id becomes null, but their spend
  -- must not start counting against the offline (global) budget.
  is_offline boolean not null,
  feature ai_feature not null,
  provider ai_provider not null,
  model text not null,
  input_tokens integer not null check (input_tokens >= 0),
  output_tokens integer not null check (output_tokens >= 0),
  cost_usd numeric(12, 6) not null check (cost_usd >= 0),
  check (not is_offline or user_id is null)
);
-- Today's spend per user, and today's offline spend.
create index ai_usage_user_day on ai_usage (user_id, occurred_at);
create index ai_usage_offline_day on ai_usage (occurred_at) where is_offline;

-- migrate:down
drop table ai_usage;
drop type ai_provider;
drop type ai_feature;
drop table ai_budget;
delete from user_capability where capability = 'ai.budget.daily_cents';
delete from plan_capability where capability = 'ai.budget.daily_cents';
