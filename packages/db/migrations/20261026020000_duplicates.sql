-- migrate:up
-- ING-1 normalize (Q-P1-08): near-duplicates link to one primary item, the earliest
-- published. The feed shows primaries only.
alter table content_item
  add column duplicate_of bigint references content_item (id) on delete set null,
  -- SimHash of the extracted text; derived from body text, so full-text rights only.
  add column simhash bigint,
  add constraint content_item_not_own_duplicate check (duplicate_of <> id);

-- The metadata match key (Q-P1-08): title with ASCII whitespace collapsed, lowercased.
create function item_title_key(title text) returns text
  language sql immutable parallel safe
  return lower(btrim(regexp_replace(title, '\s+', ' ', 'g')));

create index content_item_canonical_url on content_item (canonical_url);
create index content_item_metadata_key on content_item
  (item_title_key(title), ((published_at at time zone 'UTC')::date));
create index content_item_duplicate_of on content_item (duplicate_of)
  where duplicate_of is not null;

create function enforce_simhash_rights() returns trigger language plpgsql as $$
declare
  profile rights_profile;
begin
  if new.simhash is null then
    return new;
  end if;
  select rights_profile into profile from source where id = new.source_id;
  if profile not in ('full_text_internal', 'full_text_display') then
    raise exception 'rights profile % does not allow a simhash', profile;
  end if;
  return new;
end;
$$;

create trigger content_item_simhash_rights
  before insert or update of simhash on content_item
  for each row execute function enforce_simhash_rights();

create or replace function purge_text_beyond_profile() returns trigger language plpgsql as $$
begin
  if new.rights_profile not in ('full_text_internal', 'full_text_display') then
    delete from content_item_private_text pt
    using content_item ci
    where pt.content_item_id = ci.id and ci.source_id = new.id;
    delete from content_item_section cs
    using content_item ci
    where cs.content_item_id = ci.id and ci.source_id = new.id;
    update content_item set simhash = null
    where source_id = new.id and simhash is not null;
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

-- migrate:down
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
drop trigger content_item_simhash_rights on content_item;
drop function enforce_simhash_rights();
drop index content_item_metadata_key;
drop function item_title_key(text);
drop index content_item_duplicate_of;
drop index content_item_canonical_url;
alter table content_item
  drop constraint content_item_not_own_duplicate,
  drop column simhash,
  drop column duplicate_of;
