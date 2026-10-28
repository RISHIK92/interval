-- migrate:up
-- PDF books (§5F, DB-6, ING-5, P2-W11-S01): a user's private uploads. The file lives in
-- the private content bucket under the user's prefix; nobody else reads it. Processing
-- (S02, S03) moves a book from processing to ready, through ocr for scanned pages, or
-- to failed with a reason the user sees.
create type book_status as enum ('processing', 'ocr', 'ready', 'failed');

create table book (
  id bigint generated always as identity primary key,
  user_id text not null references app_user (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 300),
  file_key text not null unique,
  size_bytes integer not null check (size_bytes > 0),
  status book_status not null default 'processing',
  failure text,
  created_at timestamptz not null default now(),
  check ((status = 'failed') = (failure is not null))
);
create index book_user on book (user_id, created_at);

-- Q-P2-34 (owner, 2026-10-28): 5 books, 50 MB and 1,000 pages each, in the beta.
insert into plan_capability (plan_id, capability, limit_value) values
  ('beta', 'books.count', 5),
  ('beta', 'books.max_mb', 50),
  ('beta', 'books.max_pages', 1000);

-- migrate:down
delete from plan_capability
  where capability in ('books.count', 'books.max_mb', 'books.max_pages');
drop table book;
drop type book_status;
