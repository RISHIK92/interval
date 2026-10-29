import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  books,
  entitlements,
  paths,
  preferences,
  sessionReader,
} from "../../server/container";
import {
  BIGINT_ID,
  isTopic,
  type BookOutline,
  type BookStatus,
  type BookSummary,
  type PathSummary,
} from "../../server/ports";
import { deleteBookAction } from "../books/actions";
import { TabBar } from "../TabBar";
import { Card } from "../ui/Card";
import { startPathAction } from "./actions";
import { FirstVisit } from "./FirstVisit";

export const dynamic = "force-dynamic";

// §4, §5F, Q-P2-27 (P2-W10-S03): the Paths tab. The owner's live topic paths; the
// user's active one first, to continue. Start makes a path active (pausing another).
export default async function PathsPage(props: {
  searchParams: Promise<{ topic?: string; preview?: string }>;
}) {
  const actor = await sessionReader().current(await headers());
  if (actor === null) redirect("/join");
  const chosen = await preferences().get(actor.userId);
  if (chosen === null) redirect("/onboarding");
  const [all, mine, outlines] = await Promise.all([
    paths().live(actor.userId),
    books().list(actor.userId),
    books().outlines(actor.userId),
  ]);
  // Nothing added yet (no book, no path followed): the first visit (wireframe).
  if (mine.length === 0 && all.every((p) => p.mine === null)) {
    const { topic, preview } = await props.searchParams;
    const [picked, maxMb] = await Promise.all([
      preview !== undefined && BIGINT_ID.test(preview)
        ? paths().path(actor.userId, preview)
        : null,
      // OPS-3: the plan's limit, said before the upload starts.
      entitlements().limit(actor.userId, "books.max_mb"),
    ]);
    return (
      <main className="mx-auto flex max-w-xl flex-col gap-6 px-4 pt-6 pb-[calc(6rem+env(safe-area-inset-bottom))] lg:max-w-none lg:pt-10 lg:pr-8 lg:pl-68">
        <TabBar current="paths" firstName={chosen.firstName} />
        <FirstVisit
          paths={all}
          topic={topic !== undefined && isTopic(topic) ? topic : null}
          preview={picked}
          guest={actor.isGuest}
          maxMb={maxMb}
        />
      </main>
    );
  }
  const active = all.filter((p) => p.mine === "active");
  const rest = all.filter((p) => p.mine !== "active");
  return (
    <main className="mx-auto flex max-w-xl flex-col gap-6 px-4 pt-6 pb-[calc(6rem+env(safe-area-inset-bottom))] lg:max-w-[52rem] lg:pt-10 lg:pl-64">
      <h1 className="text-display">Paths</h1>
      <TabBar current="paths" firstName={chosen.firstName} />
      <YourBooks books={mine} outlines={outlines} />
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

// §5F, P2-W11-S01: the user's private PDF books; a ready one is followed like a path
// (S05, Q-P2-33).
function YourBooks({
  books: list,
  outlines,
}: {
  books: BookSummary[];
  outlines: BookOutline[];
}) {
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
          {list.map((book) => {
            const outline = outlines.find((o) => o.bookId === book.bookId);
            return outline === undefined ? (
              <li key={book.bookId}>
                <Card className="flex items-center justify-between gap-3 p-4">
                  <span className="min-w-0">
                    {book.status === "ready" ? (
                      <Link
                        href={`/books/${book.bookId}`}
                        className="block truncate font-semibold text-select"
                      >
                        {book.title}
                      </Link>
                    ) : (
                      <span className="block truncate font-semibold">
                        {book.title}
                      </span>
                    )}
                    <span className="block text-sm text-ink-muted">
                      {STATUS[book.status]}
                      {book.failure === null ? null : `: ${book.failure}`}
                    </span>
                  </span>
                  <DeleteBook book={book} />
                </Card>
              </li>
            ) : (
              <li key={book.bookId}>
                <ReadyBook book={book} outline={outline} />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

const sessions = (n: number) => `${String(n)} session${n === 1 ? "" : "s"}`;

// Wireframe 05: progress, then the chapters. Finished ones ticked; the one holding the
// next session open, its sessions ticked and the next to resume; the rest a count.
function ReadyBook({
  book,
  outline,
}: {
  book: BookSummary;
  outline: BookOutline;
}) {
  const { done, of, next } = outline;
  const href = (sessionId: string) =>
    `/books/${outline.bookId}?session=${sessionId}`;
  const current = outline.chapters.findIndex((c) =>
    c.sessions.some((s) => s.sessionId === next),
  );
  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-title">
            <Link href={`/books/${book.bookId}`}>{book.title}</Link>
          </h3>
          <p className="text-sm text-ink-muted">
            Your PDF · {done} of {of} sessions
          </p>
        </div>
        <DeleteBook book={book} />
      </div>
      <div
        role="progressbar"
        aria-label="Sessions finished"
        aria-valuemin={0}
        aria-valuenow={done}
        aria-valuemax={of}
        className="h-1.5 overflow-hidden rounded-full bg-hairline"
      >
        <div
          className="h-full rounded-full bg-select"
          style={{ width: `${String(of === 0 ? 0 : (100 * done) / of)}%` }}
        />
      </div>
      {next === null ? (
        <p className="flex items-center gap-3">
          <span className="font-semibold">Finished</span>
          <Link
            href={href(outline.first)}
            className="text-sm font-semibold text-select"
          >
            Read again
          </Link>
        </p>
      ) : null}
      {/* A finished book keeps its timeline: its chapters' checkpoints (S06). */}
      <ol aria-label="Chapters" className="flex flex-col gap-2">
        {outline.chapters.map((chapter, i) => {
          const finished = chapter.sessions.every((s) => s.finished);
          return (
            <li
              key={chapter.chapterId}
              className={
                current !== -1 && i > current ? "text-ink-muted" : undefined
              }
            >
              <p className="flex items-baseline justify-between gap-3">
                <span className={i === current ? "font-semibold" : undefined}>
                  <Mark
                    state={finished ? "done" : i === current ? "now" : "later"}
                  />
                  {finished ? (
                    <span className="sr-only">Finished: </span>
                  ) : i === current ? (
                    <span className="sr-only">Reading now: </span>
                  ) : null}
                  {chapter.title}
                </span>
                {i === current ? null : (
                  <span className="shrink-0 text-sm text-ink-muted">
                    {sessions(chapter.sessions.length)}
                  </span>
                )}
              </p>
              {i === current ? (
                <ol className="mt-2 flex flex-col gap-2 pl-6">
                  {chapter.sessions.map((s) => (
                    <li
                      key={s.sessionId}
                      className="flex flex-wrap items-center justify-between gap-2"
                    >
                      <span>
                        <Mark
                          state={
                            s.finished
                              ? "done"
                              : s.sessionId === next
                                ? "now"
                                : "later"
                          }
                        />
                        {s.finished ? (
                          <span className="sr-only">Finished: </span>
                        ) : null}
                        {s.sessionId === next ? (
                          <span className="sr-only">Up next: </span>
                        ) : null}
                        {s.title}
                        <span className="text-sm text-ink-muted">
                          {" "}
                          · {s.minutes} min
                        </span>
                      </span>
                      {s.sessionId === next ? (
                        <Link
                          href={href(s.sessionId)}
                          className="rounded-full bg-ink px-4 py-1.5 text-sm font-semibold text-page"
                        >
                          {outline.started ? "Resume" : "Start"}
                        </Link>
                      ) : null}
                    </li>
                  ))}
                </ol>
              ) : null}
              {finished ? (
                <ChapterCheckpoint
                  href={`/books/${outline.bookId}/checkpoint/${chapter.chapterId}`}
                  checkpoint={chapter.checkpoint}
                />
              ) : null}
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

// P2-W11-S06 (Q-P2-35): a finished chapter's checkpoint, as wireframe 05's timeline
// shows a section's; its end page makes it, takes it, or tries again.
function ChapterCheckpoint({
  href,
  checkpoint,
}: {
  href: string;
  checkpoint: BookOutline["chapters"][number]["checkpoint"];
}) {
  const label =
    checkpoint === null
      ? "Make the checkpoint"
      : checkpoint.state === "preparing"
        ? "Checkpoint · Preparing…"
        : checkpoint.state === "failed"
          ? "Checkpoint couldn't be made · Try again"
          : checkpoint.passed === true
            ? "Checkpoint passed"
            : checkpoint.passed === false
              ? "Checkpoint · Not yet · Retry"
              : "Take the checkpoint";
  return (
    <p className="mt-1 pl-6 text-sm">
      <Link href={href} className="font-semibold text-select">
        <span aria-hidden="true" className="mr-2">
          ⚑
        </span>
        {label}
      </Link>
    </p>
  );
}

function Mark({ state }: { state: "done" | "now" | "later" }) {
  return (
    <span
      aria-hidden="true"
      className={`mr-2 inline-block w-4 text-center ${state === "later" ? "text-ink-muted" : "text-select"}`}
    >
      {state === "done" ? "✓" : state === "now" ? "●" : "○"}
    </span>
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
