import Link from "next/link";
import type { BookOutline } from "../../server/ports";
import { Card } from "../ui/Card";
import { BookArt } from "./BookArt";

type Chapter = BookOutline["chapters"][number];

// P2-W11-S06 (Q-P2-35): where a finished chapter's checkpoint stands; its end page
// makes it, takes it, or tries again.
export function checkpointLabel(checkpoint: Chapter["checkpoint"]): string {
  return checkpoint === null
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
}

const count = (n: number, one: string) =>
  `${String(n)} ${one}${n === 1 ? "" : "s"}`;

const CHECK = "m5 12.5 4.5 4.5L19 7.5";
const BOLT = "M13 2 4 14h7l-1 8 9-12h-7z";

export function Glyph({ d, className }: { d: string; className: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={`shrink-0 ${className}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={d} />
    </svg>
  );
}

// Design "Paths, web" (wide screens): the book's next session as the hero, the current
// chapter's sessions as a strip ending in its checkpoint, then the chapters. A book's
// chapters never lock (Q-P2-35, update 2026-10-29), so later ones carry their number,
// not the design's padlock.
export function BookDetail({ outline }: { outline: BookOutline }) {
  const { next } = outline;
  const href = (sessionId: string) =>
    `/books/${outline.bookId}?session=${sessionId}`;
  const current = outline.chapters.findIndex((c) =>
    c.sessions.some((s) => s.sessionId === next),
  );
  const chapter = outline.chapters[current];
  const at = chapter?.sessions.findIndex((s) => s.sessionId === next) ?? -1;
  const session = chapter?.sessions[at];
  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-sm text-ink-muted">
          Your PDF · {count(outline.chapters.length, "chapter")}
        </p>
        <h2 className="mt-0.5 text-2xl leading-tight font-bold tracking-tight">
          {outline.title}
        </h2>
      </div>
      <Card className="flex flex-col overflow-hidden">
        <BookArt className="h-[8.125rem]" />
        <div className="flex flex-col gap-2.5 px-5 pt-4 pb-5">
          {chapter === undefined || session === undefined ? (
            <>
              <h3 className="text-[1.375rem] leading-tight font-bold tracking-tight">
                Finished
              </h3>
              <p className="text-sm text-ink-muted">
                Every session read. The chapters keep their checkpoints below.
              </p>
              <Link
                href={href(outline.first)}
                className="mt-1 self-start rounded-full bg-ink px-5 py-3 font-semibold text-page"
              >
                Read again
              </Link>
            </>
          ) : (
            <>
              <p className="flex justify-between gap-3 text-sm font-medium text-ink-muted">
                <span>
                  Chapter {current + 1} · {chapter.title} · next up
                </span>
                <span className="tabular-nums">{session.minutes} min</span>
              </p>
              <h3 className="text-[1.375rem] leading-tight font-bold tracking-tight">
                {session.title}
              </h3>
              <ol
                aria-label={`${chapter.title}: its sessions, then a 60-second checkpoint`}
                className="mt-0.5 flex gap-1.5"
              >
                {chapter.sessions.map((s, i) => (
                  <li
                    key={s.sessionId}
                    className={`flex h-[2.125rem] flex-1 items-center justify-center rounded-[0.625rem] text-[0.8125rem] font-semibold ${
                      s.sessionId === next
                        ? "border-2 border-select bg-(--distributed-systems-tint)"
                        : s.finished
                          ? "bg-go text-page"
                          : "bg-well text-ink-muted tabular-nums"
                    }`}
                  >
                    <span className="sr-only">
                      {s.finished
                        ? "Finished: "
                        : s.sessionId === next
                          ? "Up next: "
                          : ""}
                      {s.title}
                    </span>
                    <span aria-hidden="true">
                      {s.sessionId === next ? (
                        "Now"
                      ) : s.finished ? (
                        <Glyph d={CHECK} className="size-[0.9375rem]" />
                      ) : (
                        i + 1
                      )}
                    </span>
                  </li>
                ))}
                <li className="flex h-[2.125rem] flex-1 items-center justify-center gap-1 rounded-[0.625rem] bg-live/10 text-[0.8125rem] font-semibold text-wrong">
                  <Glyph d={BOLT} className="size-[0.8125rem]" />
                  60s<span className="sr-only"> checkpoint</span>
                </li>
              </ol>
              <div className="mt-1 flex flex-wrap items-center gap-2.5">
                <p className="min-w-[12.5rem] flex-1 text-sm text-ink-muted">
                  {at === chapter.sessions.length - 1
                    ? `Then the ${chapter.title} checkpoint`
                    : `${count(chapter.sessions.length - 1 - at, "more session")}, then the ${chapter.title} checkpoint`}
                </p>
                <Link
                  href={href(session.sessionId)}
                  className="flex h-12 items-center justify-center gap-2 rounded-full bg-ink px-[1.375rem] font-semibold text-page"
                >
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 24 24"
                    className="size-3.5"
                  >
                    <path d="M7 4.5v15l12-7.5z" fill="currentColor" />
                  </svg>
                  {outline.started ? "Resume" : "Start"} session {at + 1}
                </Link>
              </div>
            </>
          )}
        </div>
      </Card>
      <Chapters outline={outline} current={current} />
    </div>
  );
}

function Chapters({
  outline,
  current,
}: {
  outline: BookOutline;
  current: number;
}) {
  const { chapters } = outline;
  // Finished book: every chapter is behind the reader.
  const behind = current === -1 ? chapters.length : current;
  const done = chapters.slice(0, behind);
  const now = current === -1 ? undefined : chapters[current];
  const after = current === -1 ? [] : chapters.slice(current + 1);
  const [soon, ...later] = after;
  const passed = done.filter((c) => c.checkpoint?.passed === true).length;
  const row = "flex min-h-14 items-center gap-3 border-b border-hairline";
  const circle =
    "flex size-[1.875rem] shrink-0 items-center justify-center rounded-full";
  return (
    <section aria-label="Chapters" className="flex flex-col">
      {done.length === 0 ? null : (
        <details open={current === -1} className="group">
          <summary
            className={`${row} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}
          >
            <span className={`${circle} bg-go text-page`}>
              <Glyph d={CHECK} className="size-3.5" />
            </span>
            <span className="flex-1">
              <span className="block font-semibold">
                {done.length === 1
                  ? `Chapter 1`
                  : `Chapters 1–${String(done.length)}`}
              </span>
              <span className="mt-px block text-[0.8125rem] text-ink-muted">
                {count(passed, "checkpoint")} passed
              </span>
            </span>
            <Glyph
              d="m6 9 6 6 6-6"
              className="size-4 text-ink-muted group-open:rotate-180"
            />
          </summary>
          <ol className="flex flex-col py-1 pl-[2.625rem]">
            {done.map((c, i) => {
              const finished = c.sessions.every((s) => s.finished);
              return (
                <li
                  key={c.chapterId}
                  className="flex min-h-[2.625rem] items-center gap-2.5 border-b border-hairline text-sm"
                >
                  <span className="w-5 font-semibold text-ink-muted tabular-nums">
                    {i + 1}
                  </span>
                  <span className="flex-1 font-medium">
                    {finished ? (
                      <span className="sr-only">Finished: </span>
                    ) : null}
                    {c.title}
                  </span>
                  {finished ? (
                    <Link
                      href={`/books/${outline.bookId}/checkpoint/${c.chapterId}`}
                      className="text-[0.8125rem] font-semibold text-go-text"
                    >
                      {checkpointLabel(c.checkpoint)}
                    </Link>
                  ) : (
                    <span className="text-[0.8125rem] text-ink-muted">
                      {count(c.sessions.length, "session")}
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
        </details>
      )}
      {now === undefined ? null : (
        <div className={row}>
          <span
            className={`${circle} border-2 border-select bg-(--distributed-systems-tint) text-[0.8125rem] font-bold tabular-nums`}
          >
            {current + 1}
          </span>
          <span className="flex-1">
            <span className="block font-semibold">
              <span className="sr-only">Reading now: </span>
              Chapter {current + 1} · {now.title}
            </span>
            <span className="mt-px block text-[0.8125rem] text-ink-muted">
              {sessionOf(now, outline.next)}
            </span>
          </span>
        </div>
      )}
      {soon === undefined ? null : (
        <div
          className={later.length === 0 ? row.replace(" border-b", "") : row}
        >
          <span
            className={`${circle} border-[1.5px] border-hairline text-[0.8125rem] font-semibold text-ink-muted tabular-nums`}
          >
            {current + 2}
          </span>
          <span className="flex-1">
            <span className="block font-medium text-ink-muted">
              Chapter {current + 2} · {soon.title}
            </span>
            <span className="mt-px block text-[0.8125rem] text-ink-muted">
              {count(soon.sessions.length, "session")}
            </span>
          </span>
        </div>
      )}
      {later.length === 0 ? null : (
        <div className="flex min-h-14 items-center gap-3">
          <span
            className={`${circle} border-[1.5px] border-hairline text-ink-muted`}
          >
            <Glyph d="M5 12h14" className="size-3.5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-medium text-ink-muted">
              {later.length === 1
                ? `Chapter ${String(current + 3)}`
                : `Chapters ${String(current + 3)}–${String(chapters.length)}`}
            </span>
            <span className="mt-px block truncate text-[0.8125rem] text-ink-muted">
              {later.map((c) => c.title).join(", ")}
            </span>
          </span>
        </div>
      )}
    </section>
  );
}

function sessionOf(chapter: Chapter, next: string | null): string {
  const at = chapter.sessions.findIndex((s) => s.sessionId === next);
  const of = chapter.sessions.length;
  return at === of - 1
    ? `Session ${String(at + 1)} of ${String(of)} · checkpoint next`
    : `Session ${String(at + 1)} of ${String(of)}`;
}
