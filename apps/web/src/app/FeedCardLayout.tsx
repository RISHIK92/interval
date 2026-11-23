import type { ReactNode } from "react";
import type { Difficulty, Topic } from "@interval/db";
import { LEVEL_NAMES, TOPIC_NAMES } from "./ChoicesFields";
import type { FeedCard } from "../server/ports";
import { SectionProgress } from "./SectionProgress";
import { AiBox } from "./ui/AiBox";
import { Card } from "./ui/Card";
import { TopicArt } from "./ui/TopicArt";

// A feed card (design screen 2, ADR-0019): every card has the hero's shape, one at a
// time in Home's sideways row, with its topic's picture when the source names one.
// Deep links to the publisher, never copies (§3.2). A `read` link to the browser
// carries data-item (and data-moment) so the return prompt can ask about it; one into
// the in-app reader (ADR-0018) stays in this tab and asks on close.
// The web design's pill carries a play mark; phones keep the plain pill.
const PLAY = (
  <svg
    aria-hidden="true"
    viewBox="0 0 24 24"
    className="hidden size-3.5 lg:block"
  >
    <path d="M7 4.5v15l12-7.5z" fill="currentColor" />
  </svg>
);

export function FeedCardLayout({
  title,
  attribution,
  context,
  section,
  length,
  reasons,
  projectNote = null,
  read,
  topic,
  difficulty = null,
  controls,
  yourNote = null,
}: {
  title: string;
  attribution: string;
  context: string | null;
  section: { number: number; count: number } | null;
  length: string;
  reasons: FeedCard["reasons"];
  projectNote?: FeedCard["projectNote"];
  read: {
    href: string;
    label: string;
    item: string;
    moment?: string;
    inApp: boolean;
  };
  topic: Topic | null;
  // ADR-0027: small labels beside the length.
  difficulty?: Difficulty | null;
  controls: ReactNode;
  // P2-W7-S04: the user's own note on this section or article (Q-P2-01).
  yourNote?: string | null;
}) {
  const className =
    "inline-flex flex-1 items-center justify-center gap-2 rounded-full bg-ink px-5 py-2.5 font-semibold text-page lg:h-[50px] lg:basis-45 lg:py-0 lg:text-base";
  const readLink = read.inApp ? (
    <a
      href={read.href}
      data-read-item={read.item}
      data-read-moment={read.moment}
      className={className}
    >
      {PLAY}
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
      {PLAY}
      {read.label}
    </a>
  );
  return (
    <article className="h-full">
      <Card className="flex h-full flex-col">
        {topic === null ? null : (
          <TopicArt
            topic={topic}
            className="block h-36 w-full rounded-t-3xl sm:h-44 lg:h-[220px] lg:py-[42px]"
          />
        )}
        <div className="flex flex-1 flex-col p-5 lg:px-6 lg:py-[22px]">
          <p className="text-sm text-ink-muted lg:text-[13px] lg:font-medium">
            {attribution}
          </p>
          <h2 className="mt-1 text-title lg:mt-2.5 lg:text-[26px] lg:leading-[1.15] lg:tracking-[-0.02em]">
            {title}
          </h2>
          {context === null ? null : (
            <p className="text-ink-muted">{context}</p>
          )}
          {section === null ? null : (
            <SectionProgress number={section.number} count={section.count} />
          )}
          <p className="mt-3 text-ink-muted">{length}</p>
          {difficulty === null && topic === null ? null : (
            <p className="text-sm text-ink-muted">
              {[
                difficulty === null ? null : LEVEL_NAMES[difficulty],
                topic === null ? null : TOPIC_NAMES[topic],
              ]
                .filter((label) => label !== null)
                .join(" · ")}
            </p>
          )}
          {projectNote !== null ? (
            // P2-W12-S05 (AI-1, AI-3): the user's own project note, labelled AI and
            // naming the repositories. It replaces the why-this-matters note (owner,
            // 2026-10-29).
            <div className="mt-3">
              <AiBox>
                <span className="font-semibold">
                  For your{" "}
                  {projectNote.repositories.length > 1 ? "projects" : "project"}{" "}
                  {projectNote.repositories.join(", ")}:
                </span>{" "}
                {projectNote.text}
              </AiBox>
            </div>
          ) : reasons === null ? null : (
            // ADR-0027: the why-this-matters note, in the project note's type and
            // shape (owner, 2026-10-29). Solid line, no AI label: the dashed box marks
            // AI text (AI-1).
            <p className="mt-3 rounded-xl border border-hairline px-3 py-2 text-ink">
              {reasons.text}
            </p>
          )}
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
