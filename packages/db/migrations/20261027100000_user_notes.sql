-- migrate:up
-- Notes (§5I, Q-P2-01, P2-W7-S03): a user's private free-text note on a section (a
-- moment) or a whole article, kept with the article's URL and attribution through
-- content_item; never the article's text.
--
-- Re-segmenting can delete a moment. Its notes then fall back to the article
-- (moment_id set null) and keep the section's title, so a user's writing is never lost
-- to re-ingestion. One note per target: a section's note has a moment; the article's
-- has neither moment nor section title. A fallen-back note keeps its (never null)
-- section title, so it leaves the first index and never enters the second: it can't
-- collide and block re-segmentation.
create table user_note (
  id bigint generated always as identity primary key,
  user_id text not null references app_user (id) on delete cascade,
  content_item_id bigint not null references content_item (id) on delete cascade,
  moment_id bigint references moment (id) on delete set null,
  section_title text,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index user_note_by_user on user_note (user_id, updated_at desc);
create unique index user_note_one_per_section on user_note (user_id, moment_id)
  where moment_id is not null;
create unique index user_note_one_per_article on user_note (user_id, content_item_id)
  where moment_id is null and section_title is null;

-- migrate:down
drop table user_note;
