-- migrate:up
-- A book's text, chapters and sessions (§5F, ING-5, ING-4, P2-W11-S02), read from the
-- user's private PDF by the worker. Each page's text is kept (S03 fills in scanned
-- pages); chapters come from bookmarks or headings; sessions are 2–8 minute pieces of a
-- chapter, like moments. All private to the book's owner, and gone with the book.
alter table book add column page_count integer check (page_count > 0);

create table book_page (
  book_id bigint not null references book (id) on delete cascade,
  page_no integer not null check (page_no >= 1),
  text text not null,
  -- No text could be extracted: OCR (S03) reads it.
  scanned boolean not null,
  primary key (book_id, page_no)
);

create table book_chapter (
  id bigint generated always as identity primary key,
  book_id bigint not null references book (id) on delete cascade,
  ordinal integer not null check (ordinal >= 0),
  title text not null check (char_length(title) between 1 and 300),
  unique (book_id, ordinal)
);

create table book_session (
  id bigint generated always as identity primary key,
  chapter_id bigint not null references book_chapter (id) on delete cascade,
  ordinal integer not null check (ordinal >= 0),
  title text not null check (char_length(title) between 1 and 300),
  text text not null,
  estimated_minutes integer not null check (estimated_minutes >= 1),
  first_page integer not null check (first_page >= 1),
  unique (chapter_id, ordinal)
);

-- migrate:down
drop table book_session;
drop table book_chapter;
drop table book_page;
alter table book drop column page_count;
