"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { books, events, jobQueue, sessionReader } from "../../server/container";
import { removeBook, requestCheckpoint } from "../../server/books";
import { log } from "../../server/log";
import { BIGINT_ID } from "../../server/ports";
import { visitId } from "../../server/visits";
import { textField } from "../form";

// PDF books (§5F, P2-W11-S01, S04, S06): delete one of your own, mark a session done,
// or ask for a chapter's checkpoint. Uploads go through api/books.
async function signedIn() {
  const actor = await sessionReader().current(await headers());
  if (actor === null) redirect("/join");
  return { actor, context: { ...actor, sessionId: visitId(await cookies()) } };
}

const Delete = z.object({ bookId: z.string().regex(BIGINT_ID) });

export async function deleteBookAction(form: FormData): Promise<void> {
  const { actor, context } = await signedIn();
  const parsed = Delete.safeParse({ bookId: textField(form, "bookId") });
  if (!parsed.success) redirect("/paths");
  const { bookId } = parsed.data;
  const result = await removeBook(
    { books: books(), queue: jobQueue() },
    actor.userId,
    bookId,
  );
  if (result.removed) {
    // The book is gone for the user, but its file couldn't even be queued for removal:
    // logged with its key, and counted by the AWS stack's metric, to remove by hand.
    if (result.fileLeft !== null)
      log.error("books: file not removed", {
        bookId,
        key: result.fileLeft.key,
        error: result.fileLeft.error,
      });
    events().emit("book_deleted", { book_id: bookId }, context);
  }
  redirect("/paths#your-books");
}

// P2-W11-S04 (§5F): a session marked done, once; on to the next one, or back to the
// user's books after the last.
const Finish = z.object({
  sessionId: z.string().regex(BIGINT_ID),
  next: z.string().regex(BIGINT_ID).optional(),
});

export async function finishSessionAction(form: FormData): Promise<void> {
  const { actor, context } = await signedIn();
  const parsed = Finish.safeParse({
    sessionId: textField(form, "sessionId"),
    next: textField(form, "next") || undefined,
  });
  if (!parsed.success) redirect("/paths#your-books");
  const { sessionId, next } = parsed.data;
  const done = await books().finish(actor.userId, sessionId);
  if (done === null) redirect("/paths#your-books");
  if (done.firstTime)
    events().emit(
      "book_session_finished",
      { book_id: done.bookId, session_id: sessionId },
      context,
    );
  // S06 (Q-P2-35): the chapter's last session, just now: its checkpoint is made, and
  // the chapter's end says when it's ready.
  if (done.firstTime && done.chapterDone !== null) {
    await requestCheckpoint(
      { books: books(), queue: jobQueue() },
      actor.userId,
      done.chapterDone,
    );
    redirect(`/books/${done.bookId}/checkpoint/${done.chapterDone}`);
  }
  redirect(
    next === undefined
      ? "/paths#your-books"
      : `/books/${done.bookId}?session=${next}`,
  );
}

// S06: a finished chapter's checkpoint asked for (again, after a failure or a request
// stuck in the queue), from the chapter's end or the Paths timeline.
const Request = z.object({
  bookId: z.string().regex(BIGINT_ID),
  chapterId: z.string().regex(BIGINT_ID),
});

export async function requestCheckpointAction(form: FormData): Promise<void> {
  const { actor } = await signedIn();
  const parsed = Request.safeParse({
    bookId: textField(form, "bookId"),
    chapterId: textField(form, "chapterId"),
  });
  if (!parsed.success) redirect("/paths#your-books");
  const { bookId, chapterId } = parsed.data;
  await requestCheckpoint(
    { books: books(), queue: jobQueue() },
    actor.userId,
    chapterId,
  );
  redirect(`/books/${bookId}/checkpoint/${chapterId}`);
}
