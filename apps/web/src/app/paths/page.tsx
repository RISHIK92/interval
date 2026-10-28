import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  books,
  paths,
  preferences,
  sessionReader,
} from "../../server/container";
import type { BookStatus, BookSummary, PathSummary } from "../../server/ports";
import { deleteBookAction } from "../books/actions";
import { TabBar } from "../TabBar";
import { Card } from "../ui/Card";
import { startPathAction } from "./actions";

export const dynamic = "force-dynamic";

// §4, §5F, Q-P2-27 (P2-W10-S03): the Paths tab. The owner's live topic paths; the
// user's active one first, to continue. Start makes a path active (pausing another).
export default async function PathsPage() {
  const actor = await sessionReader().current(await headers());
  if (actor === null) redirect("/join");
  const chosen = await preferences().get(actor.userId);
  if (chosen === null) redirect("/onboarding");
  const [all, mine] = await Promise.all([
    paths().live(actor.userId),
    books().list(actor.userId),
  ]);
  const active = all.filter((p) => p.mine === "active");
  const rest = all.filter((p) => p.mine !== "active");
  return (
    <main className="mx-auto flex max-w-xl flex-col gap-6 px-4 pt-6 pb-[calc(6rem+env(safe-area-inset-bottom))] lg:max-w-[52rem] lg:pt-10 lg:pl-64">
      <h1 className="text-display">Paths</h1>
      <TabBar current="paths" firstName={chosen.firstName} />
      <YourBooks books={mine} />
      {all.length === 0 ? (
        <Card className="p-8 text-center text-ink-muted">
          <p>No paths yet. Guided paths through a topic arrive here soon.</p>
        </Card>
      ) : (
        <>
          {active.map((p) => (
            <section key={p.pathId} aria-label="Your path">
              <h2 className="mb-3 text-section">Your path</h2>
              <Card className="flex flex-col gap-3 p-5">
                <PathHead path={p} />
                <Link
                  href={`/paths/${p.pathId}`}
                  className="self-start rounded-full bg-ink px-5 py-2.5 font-semibold text-page"
                >
                  Continue
                </Link>
              </Card>
            </section>
          ))}
          <section aria-label="All paths" className="flex flex-col gap-3">
            <h2 className="text-section">
              {active.length > 0 ? "Other paths" : "Pick a path"}
            </h2>
            <ul className="flex flex-col gap-3">
              {rest.map((p) => (
                <li key={p.pathId}>
                  <Card className="flex flex-col gap-3 p-5">
                    <PathHead path={p} />
                    <div className="flex items-center gap-3">
                      {p.retired ? (
                        <span className="text-sm font-semibold text-ink-muted">
                          Retired
                        </span>
                      ) : (
                        <form action={startPathAction}>
                          <input type="hidden" name="pathId" value={p.pathId} />
                          <button
                            type="submit"
                            className="cursor-pointer rounded-full bg-ink px-5 py-2.5 font-semibold text-page"
                          >
                            {p.mine === "paused" ? "Resume" : "Start"}
                          </button>
                        </form>
                      )}
                      <Link
                        href={`/paths/${p.pathId}`}
                        className="text-sm font-semibold text-select"
                      >
                        See the path
                      </Link>
                    </div>
                  </Card>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </main>
  );
}

function PathHead({ path }: { path: PathSummary }) {
  return (
    <div className="flex flex-col gap-1">
      <h3 className="text-title">{path.name}</h3>
      <p className="text-ink-muted">{path.why}</p>
      <p className="text-sm text-ink-muted">
        {path.sections} sections · {path.readings} readings · about{" "}
        {path.minutes} min
      </p>
    </div>
  );
}

const STATUS: Record<BookStatus, string> = {
  processing: "Processing",
  ocr: "Reading scanned pages",
  ready: "Ready",
  failed: "Couldn't be read",
};

// §5F, P2-W11-S01: the user's private PDF books. Reading them arrives with S04.
function YourBooks({ books: list }: { books: BookSummary[] }) {
  return (
    <section
      id="your-books"
      aria-label="Your books"
      className="flex flex-col gap-3"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-section">Your books</h2>
        <Link href="/books/new" className="text-sm font-semibold text-select">
          Add a book
        </Link>
      </div>
      {list.length === 0 ? (
        <p className="text-ink-muted">
          Upload a PDF to read it in short sessions.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {list.map((book) => (
            <li key={book.bookId}>
              <Card className="flex items-center justify-between gap-3 p-4">
                <span className="min-w-0">
                  <span className="block truncate font-semibold">
                    {book.title}
                  </span>
                  <span className="block text-sm text-ink-muted">
                    {STATUS[book.status]}
                    {book.failure === null ? null : `: ${book.failure}`}
                  </span>
                </span>
                <DeleteBook book={book} />
              </Card>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// Deleting removes the file and everything made from it, so a native popover asks
// first: no script, no browser dialog.
function DeleteBook({ book }: { book: BookSummary }) {
  const confirm = `delete-book-${book.bookId}`;
  return (
    <>
      <button
        type="button"
        popoverTarget={confirm}
        aria-label={`Delete ${book.title}`}
        className="shrink-0 cursor-pointer rounded-full border border-hairline px-3 py-1.5 text-sm font-semibold"
      >
        Delete
      </button>
      <div
        id={confirm}
        popover="auto"
        role="alertdialog"
        aria-labelledby={`${confirm}-title`}
        className="m-auto w-[min(22rem,calc(100vw-2rem))] rounded-2xl border border-hairline bg-page p-5 text-ink shadow-card backdrop:bg-black/40"
      >
        <p id={`${confirm}-title`} className="font-semibold">
          Delete {book.title}?
        </p>
        <p className="mt-1 text-sm text-ink-muted">
          The PDF and your progress in it are removed. This can&apos;t be
          undone.
        </p>
        <div className="mt-4 flex flex-col gap-2">
          <form action={deleteBookAction}>
            <input type="hidden" name="bookId" value={book.bookId} />
            <button
              type="submit"
              className="w-full cursor-pointer rounded-full border border-wrong px-5 py-3 font-semibold"
            >
              Delete book
            </button>
          </form>
          <button
            type="button"
            autoFocus
            popoverTarget={confirm}
            popoverTargetAction="hide"
            className="w-full cursor-pointer rounded-full bg-ink px-5 py-3 font-semibold text-page"
          >
            Keep it
          </button>
        </div>
      </div>
    </>
  );
}
