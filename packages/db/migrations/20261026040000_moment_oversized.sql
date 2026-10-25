-- migrate:up
-- Q-P1-06 (P1-W3-S03): a section over 8 minutes with no subheading to split at stays one
-- moment, flagged for the admin review page (W3-S05).
alter table moment add column oversized boolean not null default false;

-- migrate:down
alter table moment drop column oversized;
