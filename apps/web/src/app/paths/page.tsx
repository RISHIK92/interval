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
import { TopicArt } from "../ui/TopicArt";
import { startPathAction } from "./actions";
import { BookDetail, checkpointLabel, Glyph } from "./BookDetail";
import { FirstVisit } from "./FirstVisit";

export const dynamic = "force-dynamic";

// §4, §5F, Q-P2-27 (P2-W10-S03): the Paths tab. The owner's live topic paths; the
// user's active one first, to continue. Start makes a path active (pausing another).
export default async function PathsPage(props: {
  searchParams: Promise<{ topic?: string; preview?: string; open?: string }>;
}) {
  const actor = await sessionReader().current(await headers());
  if (actor === null) redirect("/join");
  // ADR-0029: guests play, and only play; the rest is for accounts.
  if (actor.isGuest) redirect("/sign-up");
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
      <main
        // With a path open the page is one screen tall and only its two sides scroll.
        className={`mx-auto flex max-w-xl flex-col gap-6 px-4 pt-6 pb-[calc(6rem+env(safe-area-inset-bottom))] lg:max-w-none lg:pt-10 lg:pr-8 lg:pl-[14.5rem] ${
          picked === null ? "" : "lg:h-dvh lg:pb-10"
        }`}
      >
        <TabBar current="paths" firstName={chosen.firstName} />
        <FirstVisit
          paths={all}
          topic={topic !== undefined && isTopic(topic) ? topic : null}
          preview={picked}
          maxMb={maxMb}
        />
      </main>
    );
  }
  const active = all.filter((p) => p.mine === "active");
  const rest = all.filter((p) => p.mine !== "active");
  // Wide screens (design "Paths, web"): what the user follows in a list on the left,
  // the one picked (?open=, else the first) in the middle. A phone shows everything in
  // one column, as before, so the list and the wide-only views are hidden there.
  const items: Item[] = [
    ...active.map((p): Item => ({
      kind: "path",
      key: `path-${p.pathId}`,
      path: p,
    })),
    ...mine.map((b): Item => ({
      kind: "book",
      key: `book-${b.bookId}`,
      book: b,
      outline: outlines.find((o) => o.bookId === b.bookId),
    })),
  ];
  const { open } = await props.searchParams;
  const pickedItem = items.find((i) => i.key === open) ?? items[0];
  const picked = pickedItem?.key;
  const pickedOutline =
    pickedItem?.kind === "book" ? pickedItem.outline : undefined;
  return (
    <main className="mx-auto flex max-w-xl flex-col gap-6 px-4 pt-6 pb-[calc(6rem+env(safe-area-inset-bottom))] lg:grid lg:max-w-none lg:grid-cols-[minmax(0,1fr)_17.5rem] lg:items-start lg:gap-x-6 lg:pt-7 lg:pr-6 lg:pl-[14.5rem]">
      <TabBar current="paths" firstName={chosen.firstName} />
      <div className="flex min-w-0 flex-col gap-6">
        <header className="flex items-center justify-between gap-3">
          <h1 className="text-display">Paths</h1>
          <Link
            href="/books/new"
            className="hidden h-11 items-center gap-1.5 rounded-full border-[1.5px] border-track pr-4 pl-3.5 font-semibold lg:flex"
          >
            <Glyph d="M12 5v14M5 12h14" className="size-4" />
            Add a book
          </Link>
        </header>
        <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[13.5rem_minmax(0,1fr)] lg:items-start lg:gap-5">
          {items.length === 0 ? null : (
            <YourPaths items={items} picked={picked} />
          )}
          <div className="flex min-w-0 flex-col gap-6 lg:col-start-2">
            <YourBooks books={mine} outlines={outlines} picked={picked} />
            {all.length === 0 ? (
              <Card className="p-8 text-center text-ink-muted">
                <p>
                  No paths yet. Guided paths through a topic arrive here soon.
                </p>
              </Card>
            ) : (
              <>
                {active.map((p) => (
                  <section
                    key={p.pathId}
                    aria-label="Your path"
                    className={`path-${p.pathId}` === picked ? "" : "lg:hidden"}
                  >
                    <h2 className="mb-3 text-section lg:hidden">Your path</h2>
                    <p className="hidden text-sm text-ink-muted lg:block">
                      Your path
                    </p>
                    <h2 className="mt-0.5 mb-4 hidden text-2xl leading-tight font-bold tracking-tight lg:block">
                      {p.name}
                    </h2>
                    <Card className="flex flex-col gap-3 p-5 lg:overflow-hidden lg:p-0">
                      {p.topic === null ? null : (
                        <TopicArt
                          topic={p.topic}
                          className="hidden h-[8.125rem] w-full lg:block"
                        />
                      )}
                      <div className="flex flex-col gap-3 lg:px-5 lg:pt-4 lg:pb-5">
                        <PathHead path={p} wide />
                        <Link
                          href={`/paths/${p.pathId}`}
                          className="self-start rounded-full bg-ink px-5 py-2.5 font-semibold text-page lg:flex lg:h-12 lg:items-center lg:px-[1.375rem]"
                        >
                          Continue
                        </Link>
                      </div>
                    </Card>
                  </section>
                ))}
                {/* Wide screens drop it when empty; phones keep it, as before. */}
                <section
                  aria-label="All paths"
                  className={`flex flex-col gap-3 ${rest.length === 0 ? "lg:hidden" : ""}`}
                >
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
                                <input
                                  type="hidden"
                                  name="pathId"
                                  value={p.pathId}
                                />
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
          </div>
        </div>
      </div>
      <Rail outline={pickedOutline} />
    </main>
  );
}

type Item =
  | { kind: "path"; key: string; path: PathSummary }
  | {
      kind: "book";
      key: string;
      book: BookSummary;
      outline: BookOutline | undefined;
    };

const BOOK_ICON = "M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 21V5M8 7h7";
const PATH_ICON =
  "M6 21a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM8 19h8.5a3.5 3.5 0 0 0 0-7h-9a3.5 3.5 0 0 1 0-7H16";

// The left list on wide screens: each book and the active path, its progress, the
// picked one marked. Chapters for a book (finished of all), as the design counts.
function YourPaths({
  items,
  picked,
}: {
  items: Item[];
  picked: string | undefined;
}) {
  return (
    <nav aria-label="Your paths" className="hidden flex-col gap-1.5 lg:flex">
      {items.map((item) => {
        const title = item.kind === "path" ? item.path.name : item.book.title;
        const topic = item.kind === "path" ? item.path.topic : null;
        const outline = item.kind === "book" ? item.outline : undefined;
        const chapters = outline?.chapters ?? [];
        const finished = chapters.filter((c) =>
          c.sessions.every((s) => s.finished),
        ).length;
        return (
          <Link
            key={item.key}
            href={`/paths?open=${item.key}`}
            aria-current={item.key === picked ? "true" : undefined}
            className="flex items-center gap-3 rounded-2xl border-[1.5px] border-hairline p-3 aria-[current=true]:border-2 aria-[current=true]:border-select aria-[current=true]:bg-(--distributed-systems-tint)"
          >
            <span
              className="flex h-[3.125rem] w-10 shrink-0 items-center justify-center rounded-[0.5625rem]"
              style={{
                background: `var(--${topic ?? "distributed-systems"}-tint)`,
                color: `var(--${topic ?? "distributed-systems"}-right)`,
              }}
            >
              <Glyph
                d={item.kind === "book" ? BOOK_ICON : PATH_ICON}
                className="size-5"
              />
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-[0.3125rem]">
              <span className="text-sm leading-tight font-semibold">
                {title}
              </span>
              {outline !== undefined ? (
                <span className="flex items-center gap-1.5">
                  <span className="relative h-[0.3125rem] flex-1 overflow-hidden rounded-[3px] bg-track">
                    <span
                      className="absolute inset-y-0 left-0 rounded-[3px] bg-go"
                      style={{
                        width: `${String(chapters.length === 0 ? 0 : (100 * finished) / chapters.length)}%`,
                      }}
                    />
                  </span>
                  <span className="text-xs font-semibold text-ink-muted tabular-nums">
                    {finished}/{chapters.length}
                  </span>
                </span>
              ) : (
                <span className="text-xs text-ink-muted">
                  {item.kind === "book"
                    ? STATUS[item.book.status]
                    : `${String(item.path.sections)} sections`}
                </span>
              )}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}

// The right rail on wide screens: the picked book's next checkpoint, and the phone
// note. The design's pace plan ("1 a day", finish dates) isn't built: no pace exists.
function Rail({ outline }: { outline: BookOutline | undefined }) {
  const chapter = outline?.chapters.find((c) =>
    c.sessions.some((s) => s.sessionId === outline.next),
  );
  return (
    <aside aria-label="Your plan" className="hidden flex-col gap-3 lg:flex">
      {chapter === undefined ? null : (
        <div className="flex items-start gap-3 rounded-[1.25rem] bg-live/10 px-[1.125rem] py-4">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-page text-wrong">
            <Glyph
              d="M13 2 4 14h7l-1 8 9-12h-7z"
              className="size-[1.1875rem]"
            />
          </span>
          <span className="flex flex-col gap-0.5">
            <span className="font-semibold">Next checkpoint</span>
            <span className="text-[0.8125rem] leading-snug text-ink-muted">
              60 seconds, after session {chapter.sessions.length} of{" "}
              {chapter.title}.
            </span>
          </span>
        </div>
      )}
      <div className="flex flex-col gap-1 rounded-[1.25rem] bg-well px-[1.125rem] py-4">
        <span className="font-semibold">Read on your phone too</span>
        <span className="text-[0.8125rem] leading-snug text-ink-muted">
          Your place in a book is saved. Stop here, pick up on your phone.
        </span>
      </div>
    </aside>
  );
}

// `wide`: the active path, whose name heads the card on wide screens already.
function PathHead({ path, wide }: { path: PathSummary; wide?: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <h3 className={wide === true ? "text-title lg:sr-only" : "text-title"}>
        {path.name}
      </h3>
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
  picked,
}: {
  books: BookSummary[];
  outlines: BookOutline[];
  picked: string | undefined;
}) {
  const wide = (bookId: string) =>
    `book-${bookId}` === picked ? "" : "lg:hidden";
  return (
    <section
      id="your-books"
      aria-label="Your books"
      className="flex flex-col gap-3"
    >
      <div className="flex items-baseline justify-between gap-3 lg:hidden">
        <h2 className="text-section">Your books</h2>
        <Link href="/books/new" className="text-sm font-semibold text-select">
          Add a book
        </Link>
      </div>
      {list.length === 0 ? (
        <p className="text-ink-muted lg:hidden">
          Upload a PDF to read it in short sessions.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {list.map((book) => {
            const outline = outlines.find((o) => o.bookId === book.bookId);
            return outline === undefined ? (
              <li key={book.bookId} className={wide(book.bookId)}>
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
              <li key={book.bookId} className={wide(book.bookId)}>
                <div className="lg:hidden">
                  <ReadyBook book={book} outline={outline} />
                </div>
                {`book-${book.bookId}` === picked ? (
                  <div className="hidden lg:block">
                    <BookDetail outline={outline} />
                    <div className="mt-4 flex justify-end">
                      <DeleteBook book={book} wide />
                    </div>
                  </div>
                ) : null}
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
  const label = checkpointLabel(checkpoint);
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
// `wide`: the wide-screen copy, beside the phone's hidden one, so ids stay unique.
function DeleteBook({ book, wide }: { book: BookSummary; wide?: boolean }) {
  const confirm = `delete-book-${book.bookId}${wide === true ? "-wide" : ""}`;
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
