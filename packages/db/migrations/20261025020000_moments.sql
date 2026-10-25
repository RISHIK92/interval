-- migrate:up
-- Heading structure of a full-text item: headings and word counts only, no body text.
-- Private like content_item_private_text (ING-2); segmentation reads it (ING-4).
create table content_item_section (
  content_item_id bigint not null references content_item (id) on delete cascade,
  ordinal integer not null,
  heading text check (char_length(heading) <= 300),
  level smallint check (level between 1 and 6),
  anchor_id text,
  word_count integer not null check (word_count >= 0),
  primary key (content_item_id, ordinal)
);

create trigger content_item_section_rights
  before insert or update on content_item_section
  for each row execute function enforce_private_text_rights();

create type moment_link_type as enum ('anchor', 'text_fragment', 'page_top');

-- A moment is a deep link into the publisher's page, never a copy (§3.2): no text column.
create table moment (
  id bigint generated always as identity primary key,
  content_item_id bigint not null references content_item (id) on delete cascade,
  ordinal integer not null,
  title text not null check (char_length(title) <= 300),
  estimated_minutes integer not null check (estimated_minutes >= 1),
  link text not null,
  link_type moment_link_type not null,
  created_at timestamptz not null default now(),
  unique (content_item_id, ordinal)
);

create function enforce_moment_rights() returns trigger language plpgsql as $$
declare
  profile rights_profile;
  enabled boolean;
begin
  select s.rights_profile, s.moments_enabled into profile, enabled
  from content_item ci join source s on s.id = ci.source_id
  where ci.id = new.content_item_id;
  if not enabled or profile not in ('full_text_internal', 'full_text_display') then
    raise exception 'source (profile %, moments_enabled %) does not allow moments',
      profile, enabled;
  end if;
  return new;
end;
$$;

create trigger moment_rights
  before insert or update on moment
  for each row execute function enforce_moment_rights();

-- Lowering a profile or switching moments off removes what the source no longer allows
-- (owner, 2026-10-25; §3.2: the switch falls back to whole articles).
create or replace function purge_text_beyond_profile() returns trigger language plpgsql as $$
begin
  if new.rights_profile not in ('full_text_internal', 'full_text_display') then
    delete from content_item_private_text pt
    using content_item ci
    where pt.content_item_id = ci.id and ci.source_id = new.id;
    delete from content_item_section cs
    using content_item ci
    where cs.content_item_id = ci.id and ci.source_id = new.id;
  end if;
  if new.rights_profile <> 'excerpt' then
    update content_item set excerpt = null
    where source_id = new.id and excerpt is not null;
  end if;
  if not new.moments_enabled
    or new.rights_profile not in ('full_text_internal', 'full_text_display') then
    delete from moment m
    using content_item ci
    where m.content_item_id = ci.id and ci.source_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger source_purge_text_beyond_profile on source;
create trigger source_purge_text_beyond_profile
  after update of rights_profile, moments_enabled on source
  for each row
  when (
    old.rights_profile is distinct from new.rights_profile
    or old.moments_enabled is distinct from new.moments_enabled
  )
  execute function purge_text_beyond_profile();

-- migrate:down
drop trigger source_purge_text_beyond_profile on source;
create or replace function purge_text_beyond_profile() returns trigger language plpgsql as $$
begin
  if new.rights_profile not in ('full_text_internal', 'full_text_display') then
    delete from content_item_private_text pt
    using content_item ci
    where pt.content_item_id = ci.id and ci.source_id = new.id;
  end if;
  if new.rights_profile <> 'excerpt' then
    update content_item set excerpt = null
    where source_id = new.id and excerpt is not null;
  end if;
  return new;
end;
$$;
create trigger source_purge_text_beyond_profile
  after update of rights_profile on source
  for each row
  when (old.rights_profile is distinct from new.rights_profile)
  execute function purge_text_beyond_profile();
drop trigger moment_rights on moment;
drop function enforce_moment_rights();
drop table moment;
drop type moment_link_type;
drop trigger content_item_section_rights on content_item_section;
drop table content_item_section;
