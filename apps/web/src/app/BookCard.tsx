import Link from "next/link";
import type { BookNext } from "../server/ports";
import { Card } from "./ui/Card";

// P2-W11-S05 (§5F, Q-P2-33): the next session of the book read last, after the path's
// card. Like every card, it says why it's here (§5B).
export function BookCard({ next }: { next: BookNext }) {
  const pages =
    next.firstPage === next.lastPage
      ? `page ${String(next.firstPage)}`
      : `pages ${String(next.firstPage)}–${String(next.lastPage)}`;
  return (
    <article className="h-full">
      <Card className="flex h-full flex-col gap-3 p-5">
        <p className="text-sm font-semibold text-ink-muted">
          Next in your book:{" "}
          <Link href="/paths#your-books" className="text-select">
            {next.bookTitle}
          </Link>
        </p>
        <h2 className="text-title">{next.title}</h2>
        <p className="text-ink-muted">
          {next.chapterTitle} · session {next.place} of {next.of} · {pages} ·{" "}
          {next.minutes} min
        </p>
        <Link
          href={`/books/${next.bookId}?session=${next.sessionId}`}
          className="mt-auto inline-flex items-center justify-center self-start rounded-full bg-ink px-5 py-2.5 font-semibold text-page"
        >
          Read {next.title}
        </Link>
      </Card>
    </article>
  );
}
