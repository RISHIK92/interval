-- migrate:up
-- Per-source moments switch in the admin page (§3.2, ING-2, P1-W3-S06). The seed file
-- owns a source's settings (ADR-0006 C-28: disabling a source happens there); an admin
-- may switch its moments off. A seed reload keeps that switch: moments_enabled is
-- always moments_seeded and not moments_switched_off, kept so by the loader and the
-- admin page, and its purge trigger removes moments when it turns false.
alter table source
  add column moments_seeded boolean not null default false,
  add column moments_switched_off boolean not null default false,
  add column moments_switched_by text,
  add column moments_switched_at timestamptz;

update source set moments_seeded = moments_enabled;

alter table source add constraint source_moments_switch
  check (moments_enabled = (moments_seeded and not moments_switched_off));

-- migrate:down
alter table source drop constraint source_moments_switch;
alter table source
  drop column moments_switched_at,
  drop column moments_switched_by,
  drop column moments_switched_off,
  drop column moments_seeded;
