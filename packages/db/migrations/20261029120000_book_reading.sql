-- migrate:up
-- Reading a book in the app (§5F, Q-P2-31, P2-W11-S04): which sessions its owner has
-- finished, and where they left off. A book has one owner, so its session alone says
-- whose finish it is; both go with the book.
create table book_session_finished (
  session_id bigint primary key references book_session (id) on delete cascade,
  finished_at timestamptz not null default now()
);

create table book_position (
  book_id bigint primary key references book (id) on delete cascade,
  session_id bigint not null references book_session (id) on delete cascade,
  -- How far down the session's page the reader was, 0 (top) to 1 (end).
  fraction double precision not null check (fraction between 0 and 1),
  updated_at timestamptz not null default now()
);

-- migrate:down
drop table book_position;
drop table book_session_finished;
