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
import { Glyph } from "../../paths/BookDetail";
import { finishSessionAction } from "../actions";
import { BookPages } from "../BookPages";

export const dynamic = "force-dynamic";

const LINK =
  "rounded-full border border-hairline px-4 py-2 text-sm font-semibold lg:flex lg:h-[2.875rem] lg:items-center lg:border-[1.5px] lg:px-[1.125rem] lg:py-0 lg:text-[0.9375rem]";
// The design's dark "Next page" pill, for the next session on wide screens.
const NEXT = "lg:border-ink lg:bg-ink lg:text-page";

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
  // Wide screens (design "Book reader, web"): the chapter's sessions beside the pages.
  const outline = (await books().outlines(actor.userId)).find(
    (o) => o.bookId === reading.bookId,
  );
  const chapter = outline?.chapters.find((c) =>
    c.sessions.some((x) => x.sessionId === reading.sessionId),
  );
  const at =
    chapter?.sessions.findIndex((x) => x.sessionId === reading.sessionId) ?? -1;
  const href = (sessionId: string) =>
    `/books/${reading.bookId}?session=${sessionId}`;
  const back = `/paths?open=book-${reading.bookId}`;
  return (
    <main className="mx-auto flex max-w-xl flex-col gap-6 px-4 pt-6 pb-[calc(6rem+env(safe-area-inset-bottom))] lg:grid lg:min-h-dvh lg:max-w-none lg:grid-cols-[15rem_minmax(0,1fr)] lg:grid-rows-[auto_1fr] lg:gap-0 lg:p-0">
      {/* The design reads full screen: the sidebar steps aside on wide screens. */}
      <div className="lg:hidden">
        <TabBar current="paths" firstName={chosen.firstName} />
      </div>
      <header className="hidden items-center gap-3.5 border-b border-hairline px-5 py-3.5 lg:col-span-2 lg:flex">
        <Link
          href={back}
          aria-label="Close book"
          className="flex size-11 shrink-0 items-center justify-center rounded-full"
        >
          <Glyph d="M18 6 6 18M6 6l12 12" className="size-[1.3125rem]" />
        </Link>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="truncate text-sm font-medium text-ink-muted">
            {reading.bookTitle} · {reading.chapterTitle}
            {chapter === undefined
              ? ""
              : ` · Session ${String(at + 1)} of ${String(chapter.sessions.length)}`}
          </span>
          {chapter === undefined ? null : (
            <span aria-hidden="true" className="flex max-w-[22.5rem] gap-1">
              {chapter.sessions.map((x) => (
                <span
                  key={x.sessionId}
                  className={`h-1.5 flex-1 rounded-[3px] ${x.finished ? "bg-go" : "bg-track"}`}
                />
              ))}
            </span>
          )}
        </div>
        <span className="text-sm font-semibold text-ink-muted tabular-nums">
          {reading.minutes} min
        </span>
      </header>
      {chapter === undefined ? null : (
        <nav
          aria-label="Chapter contents"
          className="hidden flex-col gap-0.5 border-r border-hairline px-4 py-6 lg:flex"
        >
          <span className="px-2.5 pb-2 text-[0.8125rem] font-semibold text-ink-muted">
            {reading.chapterTitle}
          </span>
          {chapter.sessions.map((x) => (
            <Link
              key={x.sessionId}
              href={href(x.sessionId)}
              aria-current={
                x.sessionId === reading.sessionId ? "page" : undefined
              }
              className={`flex min-h-[2.375rem] items-center gap-2.5 rounded-[0.625rem] px-2.5 text-sm leading-snug ${
                x.sessionId === reading.sessionId
                  ? "bg-(--distributed-systems-tint) font-semibold"
                  : x.finished
                    ? ""
                    : "text-ink-muted"
              }`}
            >
              <span
                className={`flex size-4 shrink-0 items-center justify-center rounded-full ${
                  x.finished
                    ? "bg-go text-page"
                    : x.sessionId === reading.sessionId
                      ? "border-2 border-select"
                      : "border-[1.5px] border-track"
                }`}
              >
                {x.finished ? (
                  <Glyph d="m5 12.5 4.5 4.5L19 7.5" className="size-2.5" />
                ) : null}
                <span className="sr-only">
                  {x.finished ? "Finished: " : ""}
                </span>
              </span>
              {x.title}
            </Link>
          ))}
          <span className="mx-2.5 mt-2 flex items-center gap-2 rounded-xl bg-live/10 px-3 py-2.5 text-[0.8125rem] font-semibold text-wrong">
            <Glyph d="M13 2 4 14h7l-1 8 9-12h-7z" className="size-3.5" />
            60s checkpoint after session {chapter.sessions.length}
          </span>
        </nav>
      )}
      <div
        className={`flex min-w-0 flex-col gap-6 lg:px-10 lg:pt-9 lg:pb-7 ${chapter === undefined ? "lg:col-span-2" : ""}`}
      >
        <header className="flex flex-col gap-1 lg:mx-auto lg:w-full lg:max-w-[42.5rem]">
          <p className="text-sm text-ink-muted lg:hidden">
            <Link
              href="/paths#your-books"
              className="font-semibold text-select"
            >
              {reading.bookTitle}
            </Link>{" "}
            · {reading.chapterTitle}
          </p>
          <h1 className="text-display lg:text-[2rem] lg:leading-tight lg:font-bold lg:tracking-tight">
            {reading.title}
          </h1>
          <p className="text-sm text-ink-muted">
            Session {reading.place} of {reading.of} ·{" "}
            {reading.firstPage === reading.lastPage
              ? `page ${String(reading.firstPage)}`
              : `pages ${String(reading.firstPage)}–${String(reading.lastPage)}`}{" "}
            · {reading.minutes} min
            {reading.finished ? " · Finished" : ""}
          </p>
        </header>
        <div className="lg:mx-auto lg:w-full lg:max-w-[42.5rem]">
          <BookPages
            key={reading.sessionId}
            bookId={reading.bookId}
            sessionId={reading.sessionId}
            firstPage={reading.firstPage}
            lastPage={reading.lastPage}
            fraction={reading.fraction}
          />
        </div>
        <footer className="flex flex-col gap-4 border-t border-hairline pt-6 lg:mx-auto lg:w-full lg:max-w-[42.5rem] lg:flex-row lg:flex-wrap lg:items-center lg:gap-2.5 lg:pt-[1.125rem]">
          {chapter === undefined ? null : (
            <div className="hidden min-w-[12.5rem] flex-1 lg:block">
              <div className="font-semibold">{reading.minutes} min session</div>
              <div className="mt-px text-[0.8125rem] text-ink-muted">
                {at === chapter.sessions.length - 1
                  ? "Then a 60-second checkpoint"
                  : `Then session ${String(at + 2)}, and a 60-second checkpoint after session ${String(chapter.sessions.length)}`}
              </div>
            </div>
          )}
          {reading.finished ? null : (
            <form
              action={finishSessionAction}
              className="flex items-center gap-3"
            >
              <input type="hidden" name="sessionId" value={reading.sessionId} />
              {reading.next === null ? null : (
                <input type="hidden" name="next" value={reading.next} />
              )}
              <span className="font-semibold lg:sr-only">Finished?</span>
              <button
                type="submit"
                className="cursor-pointer rounded-full bg-ink px-5 py-2.5 font-semibold text-page lg:h-[2.875rem] lg:border-[1.5px] lg:border-hairline lg:bg-transparent lg:py-0 lg:text-[0.9375rem] lg:text-ink"
              >
                Mark done
              </button>
            </form>
          )}
          <nav
            aria-label="Sessions"
            className="flex justify-between gap-3 lg:gap-2.5"
          >
            {reading.previous === null ? (
              <span />
            ) : (
              <Link href={href(reading.previous)} className={LINK}>
                ← Previous
              </Link>
            )}
            {reading.next === null ? null : (
              <Link href={href(reading.next)} className={`${LINK} ${NEXT}`}>
                Next →
              </Link>
            )}
          </nav>
        </footer>
      </div>
    </main>
  );
}
