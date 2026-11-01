-- migrate:up
-- P3-W13-S07 (ADR-0029; owner, 2026-11-02): at most 10 guests a day from one network.
-- The address is kept only as a keyed hash; starts over a day old are deleted at the
-- next start (apps/web/src/server/adapters/kysely-guest-limits.ts).
create table guest_start (
  ip_key bytea not null,
  created_at timestamptz not null default now()
);
create index guest_start_key on guest_start (ip_key, created_at);

-- migrate:down
drop table guest_start;
