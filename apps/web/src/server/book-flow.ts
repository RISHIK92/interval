import { requestCheckpoint } from "./books";
import { books, events, jobQueue } from "./container";
import type { EventContext } from "./events";

// P2-W11-S04, S06 (§5F, Q-P2-35): a book session marked done, once. The chapter's last
// session, just now, asks for the chapter's checkpoint. The web's action and the app's
// route (P4-W21-S04) both go through here. Null: not a session of the user's.
export async function finishBookSession(
  context: EventContext,
  sessionId: string,
): Promise<{ bookId: string; chapterDone: string | null } | null> {
  const done = await books().finish(context.userId, sessionId);
  if (done === null) return null;
  if (done.firstTime)
    events().emit(
      "book_session_finished",
      { book_id: done.bookId, session_id: sessionId },
      context,
    );
  const chapterDone = done.firstTime ? done.chapterDone : null;
  if (chapterDone !== null)
    await requestCheckpoint(
      { books: books(), queue: jobQueue() },
      context.userId,
      chapterDone,
    );
  return { bookId: done.bookId, chapterDone };
}
