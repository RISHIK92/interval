-- migrate:up
-- Conditional requests (ING-1): the validators a URL last answered with, sent back as
-- If-None-Match / If-Modified-Since so an unchanged feed costs the publisher a 304.
create table fetch_validator (
  url text primary key,
  etag text,
  last_modified text,
  updated_at timestamptz not null default now(),
  check (etag is not null or last_modified is not null)
);

-- migrate:down
drop table fetch_validator;
