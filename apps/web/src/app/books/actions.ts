"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { books, events, jobQueue, sessionReader } from "../../server/container";
import { removeBook } from "../../server/books";
import { log } from "../../server/log";
import { BIGINT_ID } from "../../server/ports";
import { visitId } from "../../server/visits";
import { textField } from "../form";

// PDF books (§5F, P2-W11-S01): delete one of your own. Uploads go through api/books.
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
