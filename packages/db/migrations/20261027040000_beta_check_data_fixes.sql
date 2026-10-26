-- migrate:up
-- Fixes for rows stored before the worker learned these rules (owner, 2026-10-27 beta
-- check). New fetches and checks already store them this way.

-- The reader frames https only (frame-src https:, ADR-0018): an http page is never
-- framable, whatever its headers said.
update content_item set frameable = false
where frameable and canonical_url not like 'https://%';

-- A card shows the author's name only, never an email (feedparser joined them):
-- "email (Name)", "Name (email)" and "Name <email>" keep the name; anything left
-- with an email in it keeps nothing.
update content_item
set author = (
  select case when name like '%@%' or name = '' then null else name end
  from (select btrim(case
    when author ~ '^\S+@\S+\s*\((.+)\)$'
      then substring(author from '^\S+@\S+\s*\((.+)\)$')
    when author ~ '^(.+?)\s*\(\S+@\S+\)$'
      then substring(author from '^(.+?)\s*\(\S+@\S+\)$')
    when author ~ '^(.+?)\s*<\S+@\S+>$'
      then substring(author from '^(.+?)\s*<\S+@\S+>$')
    else ''
  end) as name) cleaned
)
where author like '%@%';

-- migrate:down
-- Data fixes only: the old values were wrong and aren't kept.
