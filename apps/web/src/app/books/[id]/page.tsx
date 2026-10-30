import { cookies, headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  books,
  events,
  preferences,
  sessionReader,
} from "../../../server/container";
import { BIGINT_ID } from "../../../server/ports";
import { visitId } from "../../../server/visits";
import { TabBar } from "../../TabBar";
import { finishSessionAction } from "../actions";
import { BookPages } from "../BookPages";

export const dynamic = "force-dynamic";

const LINK =
  "rounded-full border border-hairline px-4 py-2 text-sm font-semibold";

// §5F, Q-P2-31 updated (owner, 2026-10-28; P2-W11-S04): a book's session in the app,
// shown as its own PDF pages, with the user's place kept and the way on. The extracted
// text is for checkpoints (S06), not shown (owner, 2026-10-28).
export default async function BookPage(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ session?: string }>;
}) {
  const actor = await sessionReader().current(await headers());
  if (actor === null) redirect("/join");
  // ADR-0029: guests play, and only play; the rest is for accounts.
  if (actor.isGuest) redirect("/sign-up");
  const chosen = await preferences().get(actor.userId);
  if (chosen === null) redirect("/onboarding");
  const { id } = await props.params;
  const { session } = await props.searchParams;
  if (!BIGINT_ID.test(id)) notFound();
  const reading = await books().reading(
    actor.userId,
    id,
    session !== undefined && BIGINT_ID.test(session) ? session : null,
  );
  // Not the user's (or not there): as if it didn't exist. Not ready yet: back to the
  // list, which says why.
  if (reading === null) {
    const mine = await books().list(actor.userId);
    if (mine.some((b) => b.bookId === id)) redirect("/paths#your-books");
    notFound();
  }
  events().emit(
    "book_opened",
    { book_id: reading.bookId, session_id: reading.sessionId },
    { ...actor, sessionId: visitId(await cookies()) },
  );
  return (
    <main className="mx-auto flex max-w-xl flex-col gap-6 px-4 pt-6 pb-[calc(6rem+env(safe-area-inset-bottom))] lg:max-w-[46rem] lg:pt-10 lg:pl-64">
      <TabBar current="paths" firstName={chosen.firstName} />
      <header className="flex flex-col gap-1">
        <p className="text-sm text-ink-muted">
          <Link href="/paths#your-books" className="font-semibold text-select">
            {reading.bookTitle}
          </Link>{" "}
          · {reading.chapterTitle}
        </p>
        <h1 className="text-display">{reading.title}</h1>
        <p className="text-sm text-ink-muted">
          Session {reading.place} of {reading.of} ·{" "}
          {reading.firstPage === reading.lastPage
            ? `page ${String(reading.firstPage)}`
            : `pages ${String(reading.firstPage)}–${String(reading.lastPage)}`}{" "}
          · {reading.minutes} min
          {reading.finished ? " · Finished" : ""}
        </p>
      </header>
      <BookPages
        key={reading.sessionId}
        bookId={reading.bookId}
        sessionId={reading.sessionId}
        firstPage={reading.firstPage}
        lastPage={reading.lastPage}
        fraction={reading.fraction}
      />
      <footer className="flex flex-col gap-4 border-t border-hairline pt-6">
        {reading.finished ? null : (
          <form
            action={finishSessionAction}
            className="flex items-center gap-3"
          >
            <input type="hidden" name="sessionId" value={reading.sessionId} />
            {reading.next === null ? null : (
              <input type="hidden" name="next" value={reading.next} />
            )}
            <span className="font-semibold">Finished?</span>
            <button
              type="submit"
              className="cursor-pointer rounded-full bg-ink px-5 py-2.5 font-semibold text-page"
            >
              Mark done
            </button>
          </form>
        )}
        <nav aria-label="Sessions" className="flex justify-between gap-3">
          {reading.previous === null ? (
            <span />
          ) : (
            <Link
              href={`/books/${reading.bookId}?session=${reading.previous}`}
              className={LINK}
            >
              ← Previous
            </Link>
          )}
          {reading.next === null ? null : (
            <Link
              href={`/books/${reading.bookId}?session=${reading.next}`}
              className={LINK}
            >
              Next →
            </Link>
          )}
        </nav>
      </footer>
    </main>
  );
}
