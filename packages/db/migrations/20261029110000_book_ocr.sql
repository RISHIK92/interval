-- migrate:up
-- OCR for scanned book pages (ADR-0022, P2-W11-S03): a scanned page's text arrives from
-- the OCR service later; this marks when it did (or when OCR gave up on it, empty).
-- The book is built into chapters once no scanned page is left unread.
alter table book_page add column ocr_read_at timestamptz;
alter table book_page add constraint book_page_ocr_scanned
  check (ocr_read_at is null or scanned);

-- migrate:down
alter table book_page drop constraint book_page_ocr_scanned;
alter table book_page drop column ocr_read_at;
