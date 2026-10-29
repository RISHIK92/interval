import type { ReactNode } from "react";
import type { Topic } from "@interval/db";
import type { FeedCard } from "../server/ports";
import { SectionProgress } from "./SectionProgress";
import { AiBox } from "./ui/AiBox";
import { Card } from "./ui/Card";
import { TopicArt } from "./ui/TopicArt";
import { WhyNote } from "./WhyNote";

// A feed card (design screen 2, ADR-0019): every card has the hero's shape, one at a
// time in Home's sideways row, with its topic's picture when the source names one.
// Deep links to the publisher, never copies (§3.2). A `read` link to the browser
// carries data-item (and data-moment) so the return prompt can ask about it; one into
// the in-app reader (ADR-0018) stays in this tab and asks on close.
export function FeedCardLayout({
  title,
  attribution,
  context,
  section,
  length,
  note,
  projectNote = null,
  read,
  topic,
  controls,
  yourNote = null,
}: {
  title: string;
  attribution: string;
  context: string | null;
  section: { number: number; count: number } | null;
  length: string;
  note: FeedCard["note"];
  projectNote?: FeedCard["projectNote"];
  read: {
    href: string;
    label: string;
    item: string;
    moment?: string;
    inApp: boolean;
  };
  topic: Topic | null;
  controls: ReactNode;
  // P2-W7-S04: the user's own note on this section or article (Q-P2-01).
  yourNote?: string | null;
}) {
  const className =
    "inline-flex flex-1 items-center justify-center rounded-full bg-ink px-5 py-2.5 font-semibold text-page";
  const readLink = read.inApp ? (
    <a
      href={read.href}
      data-read-item={read.item}
      data-read-moment={read.moment}
      className={className}
    >
      {read.label}
    </a>
  ) : (
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
  return (
    <article className="h-full">
      <Card className="flex h-full flex-col">
        {topic === null ? null : (
          <TopicArt
            topic={topic}
            className="block h-36 w-full rounded-t-3xl sm:h-44"
          />
        )}
        <div className="flex flex-1 flex-col p-5">
          <p className="text-sm text-ink-muted">{attribution}</p>
          <h2 className="mt-1 text-title">{title}</h2>
          {context === null ? null : (
            <p className="text-ink-muted">{context}</p>
          )}
          {section === null ? null : (
            <SectionProgress number={section.number} count={section.count} />
          )}
          <p className="mt-3 text-ink-muted">{length}</p>
          <div className="mt-3 empty:hidden">
            {projectNote === null ? (
              <WhyNote note={note} />
            ) : (
              // ADR-0025: the user's own project line, when written, is the card's
              // one explanation (AI-1, AI-3: labelled AI, naming the repositories).
              <AiBox>
                <span className="font-semibold">
                  For your{" "}
                  {projectNote.repositories.length > 1 ? "projects" : "project"}{" "}
                  {projectNote.repositories.join(", ")}:
                </span>{" "}
                {projectNote.text}
              </AiBox>
            )}
          </div>
          {yourNote === null ? null : (
            <p className="mt-2 line-clamp-2 text-sm whitespace-pre-line">
              <span className="font-semibold">Your note: </span>
              {yourNote}
            </p>
          )}
          {/* The actions sit at the bottom, level across the row's cards. */}
          <div className="mt-auto flex items-center gap-2 pt-4">
            {readLink}
            {controls}
          </div>
        </div>
      </Card>
    </article>
  );
}
