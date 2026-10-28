-- migrate:up
-- The reader shows a section's own PDF pages (owner, 2026-10-28, Q-P2-31 updated): each
-- session knows its last page too. Sessions next to each other can share a page. Those
-- read before this change end where the next one starts (else at the book's end).
alter table book_session add column last_page integer;
update book_session s set last_page = greatest(s.first_page, coalesce(
  (select n.first_page from book_session n
   join book_chapter nc on nc.id = n.chapter_id
   join book_chapter sc on sc.id = s.chapter_id
   where nc.book_id = sc.book_id
     and (nc.ordinal, n.ordinal) > (sc.ordinal, s.ordinal)
   order by nc.ordinal, n.ordinal
   limit 1),
  (select b.page_count from book b join book_chapter c on c.book_id = b.id
   where c.id = s.chapter_id),
  s.first_page
));
alter table book_session alter column last_page set not null;
alter table book_session add constraint book_session_pages check (last_page >= first_page);

-- migrate:down
alter table book_session drop constraint book_session_pages;
alter table book_session drop column last_page;
