-- migrate:up
-- The pronunciation dictionary (TTS-2, Q-P4-10, P4-W22-S02): technical terms and how to
-- say them, applied to explainer scripts before TTS. From the repo's YAML seed
-- (`load-pronunciations`) or added on /admin/pronunciations; a seed reload leaves the
-- admin's alone.
create table pronunciation (
  id bigint generated always as identity primary key,
  term text not null check (char_length(term) between 1 and 80),
  say text not null check (char_length(say) between 1 and 200),
  origin text not null check (origin in ('seed', 'admin')),
  added_by text references app_user (id) on delete set null,
  created_at timestamptz not null default now()
);

-- One spelling a term, whatever its case.
create unique index pronunciation_term on pronunciation (lower(term));

-- migrate:down
drop table pronunciation;
