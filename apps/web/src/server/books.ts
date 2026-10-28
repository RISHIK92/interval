import { randomUUID } from "node:crypto";
import { log } from "./log";
import type { Books, Entitlements, FileStore, JobQueue } from "./ports";

// PDF books (§5F, DB-6, Q-P2-34, P2-W11-S01): a user's upload, checked, stored privately
// under their prefix, and queued for processing (S02). Nothing is left half made: a
// failed store or queue undoes the row and the file.
export type AddBook =
  | { ok: true; bookId: string }
  | { ok: false; reason: "not_pdf" | "too_large" | "limit" };

const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"
const MB = 1024 * 1024;

// The title until processing reads the PDF's own (S02): the file name, without .pdf.
export function titleOf(fileName: string): string {
  const base = fileName.replace(/\.pdf$/i, "").trim();
  return (base === "" ? "Untitled book" : base).slice(0, 300);
}

export async function addBook(
  deps: {
    books: Books;
    files: FileStore;
    queue: JobQueue;
    entitlements: Entitlements;
  },
  userId: string,
  upload: { name: string; bytes: Uint8Array },
): Promise<AddBook> {
  const { bytes } = upload;
  // By its header, not its name.
  if (bytes.length < PDF.length || PDF.some((b, i) => bytes[i] !== b))
    return { ok: false, reason: "not_pdf" };
  const maxMb = await deps.entitlements.limit(userId, "books.max_mb");
  if (maxMb !== null && bytes.length > maxMb * MB)
    return { ok: false, reason: "too_large" };
  const fileKey = `books/${userId}/${randomUUID()}.pdf`;
  const created = await deps.books.create(
    userId,
    titleOf(upload.name),
    bytes.length,
    fileKey,
  );
  if (created === "limit") return { ok: false, reason: "limit" };
  const { bookId } = created;
  try {
    await deps.files.put(fileKey, bytes, "application/pdf");
    // LOAD-5: one processing job per book.
    await deps.queue.enqueue(
      "book_process",
      { book_id: Number(bookId) },
      { idempotencyKey: `book-${bookId}` },
    );
  } catch (error) {
    // Undone, so no book waits forever without its file or its job. A put that timed
    // out may have stored the file anyway, so it goes too. Undo failures are logged;
    // the original error is the one thrown.
    await undo("books: upload undo failed", fileKey, () =>
      deps.books.remove(userId, bookId),
    );
    await undo("books: upload undo failed", fileKey, () =>
      deps.files.remove(fileKey),
    );
    throw error;
  }
  return { ok: true, bookId };
}

async function undo(
  msg: string,
  key: string,
  step: () => Promise<unknown>,
): Promise<void> {
  try {
    await step();
  } catch (error) {
    log.error(msg, { key, error });
  }
}

// The row first, so the book is gone for the user at once; its file is then removed by
// the worker, with the queue's retries (LOAD-5). If even queueing fails, the file is
// reported (the caller logs it) and nothing points to it any more.
export type RemoveBook =
  | { removed: false }
  | { removed: true; fileLeft: null | { key: string; error: unknown } };

export async function removeBook(
  deps: { books: Books; queue: JobQueue },
  userId: string,
  bookId: string,
): Promise<RemoveBook> {
  const key = await deps.books.remove(userId, bookId);
  if (key === null) return { removed: false };
  try {
    await deps.queue.enqueue(
      "remove_file",
      { key },
      { idempotencyKey: `remove/${key}` },
    );
    return { removed: true, fileLeft: null };
  } catch (error) {
    return { removed: true, fileLeft: { key, error } };
  }
}

// P2-W11-S06 (Q-P2-35): a finished chapter's checkpoint asked for, and queued to be
// made. A job that can't be queued is logged and leaves the checkpoint preparing;
// after STUCK_MINUTES the chapter's end offers to ask again (LOAD-5). False when
// there was nothing to ask for (not the user's, or made or being made).
export async function requestCheckpoint(
  deps: { books: Books; queue: JobQueue },
  userId: string,
  chapterId: string,
): Promise<boolean> {
  const request = await deps.books.requestCheckpoint(userId, chapterId);
  if (request === null) return false;
  try {
    await deps.queue.enqueue(
      "book_checkpoint",
      { chapter_id: Number(chapterId) },
      { idempotencyKey: `book-checkpoint-${chapterId}-${String(request)}` },
    );
  } catch (error) {
    log.error("books: checkpoint not queued", { chapterId, error });
  }
  return true;
}
