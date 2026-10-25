-- migrate:up
-- ING-2 rights profile levels; what each permits is the Q-P1-01 matrix (worker rights.py).
create type rights_profile as enum (
  'metadata_only',
  'excerpt',
  'full_text_internal',
  'full_text_display'
);

create table source (
  id bigint generated always as identity primary key,
  name text not null unique,
  homepage text,
  feed_url text not null unique,
  rights_profile rights_profile not null default 'metadata_only',
  moments_enabled boolean not null default false,
  paywalled boolean not null default false,
  created_at timestamptz not null default now()
);

create table content_item (
  id bigint generated always as identity primary key,
  source_id bigint not null references source (id),
  guid text not null,
  canonical_url text not null,
  title text not null,
  author text,
  published_at timestamptz,
  feed_summary text check (char_length(feed_summary) <= 300),
  excerpt text check (char_length(excerpt) <= 300),
  fetched_at timestamptz not null default now(),
  unique (source_id, guid)
);

-- Extracted body text for internal processing only; never displayed (ING-2).
create table content_item_private_text (
  content_item_id bigint primary key references content_item (id) on delete cascade,
  text text not null,
  extracted_at timestamptz not null default now()
);

-- Second guard behind the worker's rights gate: the database itself refuses body text
-- that the source's profile does not allow.
create function enforce_private_text_rights() returns trigger language plpgsql as $$
declare
  profile rights_profile;
begin
  select s.rights_profile into profile
  from content_item ci join source s on s.id = ci.source_id
  where ci.id = new.content_item_id;
  if profile not in ('full_text_internal', 'full_text_display') then
    raise exception 'rights profile % does not allow storing full text', profile;
  end if;
  return new;
end;
$$;

create trigger content_item_private_text_rights
  before insert or update on content_item_private_text
  for each row execute function enforce_private_text_rights();

create function enforce_excerpt_rights() returns trigger language plpgsql as $$
declare
  profile rights_profile;
begin
  if new.excerpt is null then
    return new;
  end if;
  select rights_profile into profile from source where id = new.source_id;
  if profile <> 'excerpt' then
    raise exception 'rights profile % does not allow storing an excerpt', profile;
  end if;
  return new;
end;
$$;

create trigger content_item_excerpt_rights
  before insert or update on content_item
  for each row execute function enforce_excerpt_rights();

-- Lowering a profile removes stored text the new profile forbids (owner, 2026-10-25), so
-- ING-2 holds for stored data, not only for new writes.
create function purge_text_beyond_profile() returns trigger language plpgsql as $$
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

-- migrate:down
drop trigger source_purge_text_beyond_profile on source;
drop function purge_text_beyond_profile();
drop trigger content_item_excerpt_rights on content_item;
drop function enforce_excerpt_rights();
drop trigger content_item_private_text_rights on content_item_private_text;
drop function enforce_private_text_rights();
drop table content_item_private_text;
drop table content_item;
drop table source;
drop type rights_profile;
