import type { ReactNode } from "react";
import type { FeedCard } from "../server/ports";
import { SectionProgress } from "./SectionProgress";
import { Card } from "./ui/Card";
import { WhyNote } from "./WhyNote";

// The two shapes of a feed card on Home (design screen 2): the first card is the hero,
// the rest are compact rows. Both are deep links to the publisher, never copies (§3.2).
// A row sits under "Also fits in …", so only the hero says it fits. `read` carries
// data-item (and data-moment) so the return prompt can ask about it.
export function FeedCardLayout({
  hero,
  title,
  attribution,
  context,
  section,
  length,
  fits,
  note,
  read,
  originalHref,
  controls,
}: {
  hero: boolean;
  title: string;
  attribution: string;
  context: string | null;
  section: { number: number; count: number } | null;
  length: string;
  fits: string | null;
  note: FeedCard["note"];
  read: { href: string; label: string; item: string; moment?: string };
  originalHref: string | null;
  controls: ReactNode;
}) {
  const readLink = (className: string) => (
    <a
      href={read.href}
      data-item={read.item}
      data-moment={read.moment}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
    >
      {read.label}
    </a>
  );
  const original =
    originalHref === null ? null : (
      <a
        href={originalHref}
        target="_blank"
        rel="noopener noreferrer"
        className="text-sm text-ink-muted underline-offset-2 hover:underline"
      >
        Open original website
      </a>
    );
  if (hero) {
    return (
      <article>
        <Card className="p-5">
          <p className="text-sm text-ink-muted">{attribution}</p>
          <h2 className="mt-1 text-title">{title}</h2>
          {context === null ? null : (
            <p className="text-ink-muted">{context}</p>
          )}
          {section === null ? null : (
            <SectionProgress number={section.number} count={section.count} />
          )}
          <p className="mt-3 text-ink-muted">{length}</p>
          {fits === null ? null : <p className="font-semibold">{fits}</p>}
          <div className="mt-3 empty:hidden">
            <WhyNote note={note} />
          </div>
          <div className="mt-4 flex items-center gap-2">
            {readLink(
              "inline-flex flex-1 items-center justify-center rounded-full bg-ink px-5 py-2.5 font-semibold text-page",
            )}
            {controls}
          </div>
          {original === null ? null : <p className="mt-3">{original}</p>}
        </Card>
      </article>
    );
  }
  return (
    <article className="flex items-start gap-3 py-3">
      <span
        aria-hidden="true"
        className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-well text-ink-muted"
      >
        <svg
          viewBox="0 0 24 24"
          className="size-5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        >
          <path d="M6 3h9l3 3v15H6z M9 10h6 M9 14h6 M9 18h4" />
        </svg>
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="font-semibold">{title}</h3>
        <p className="text-sm text-ink-muted">{`${length} · ${attribution}`}</p>
        {context === null ? null : (
          <p className="text-sm text-ink-muted">{context}</p>
        )}
        <div className="mt-1 text-sm empty:hidden">
          <WhyNote note={note} />
        </div>
        <p className="mt-1 flex flex-wrap gap-x-3 text-sm">
          {readLink("font-semibold text-select")}
          {original}
        </p>
      </div>
      {controls}
    </article>
  );
}
