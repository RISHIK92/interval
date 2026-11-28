import { startReviewAction } from "./quiz/actions";
import { reviewMinutes } from "./reviewTime";
import { Card } from "./ui/Card";

const NAMED = 2; // then "and N more" (owner, 2026-10-30)

const recalled = (days: number | null) =>
  days === null
    ? "not recalled yet"
    : days === 0
      ? "last recalled today"
      : days === 1
        ? "last recalled yesterday"
        : `last recalled ${String(days)} days ago`;

// P2-W9-S06 (Q-P2-17, REC-1 "due reviews"): the feed's second card when anything is
// due; its button starts the review (owner, 2026-10-30), as the Library's does. Like every card, it says why it's here
// (§5B).
// Owner (2026-10-30): it looks like a quiz about to start, each due concept a question
// tile (the quiz's option shape) saying when it was last recalled.
export function ReviewCard({
  due,
}: {
  due: { name: string; daysSince: number | null }[];
}) {
  const one = due.length === 1;
  const more = due.length - NAMED;
  return (
    <article className="h-full">
      {/* Wide screens (review card redesign, 2026-11): the Review family's ground, a pill
        naming the card, the count on a raised inner card, the concepts as compact rows,
        and no picture band. */}
      <Card className="flex h-full flex-col lg:border-(--review-top) lg:bg-(--review-tint)">
        <ReviewArt />
        <div className="flex flex-1 flex-col p-5 lg:gap-3.5 lg:p-[18px]">
          <p className="text-sm text-ink-muted lg:flex lg:h-7 lg:items-center lg:gap-[7px] lg:self-start lg:rounded-full lg:bg-card lg:pr-[11px] lg:pl-[9px] lg:text-[13px] lg:font-semibold lg:text-(--review-line)">
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              className="hidden size-3.5 lg:block"
            >
              <rect
                x="3"
                y="7"
                width="13"
                height="14"
                rx="3.5"
                fill="currentColor"
                opacity="0.35"
              />
              <rect
                x="8"
                y="3"
                width="13"
                height="14"
                rx="3.5"
                fill="currentColor"
              />
            </svg>
            Spaced review
          </p>
          <div className="lg:flex lg:flex-col lg:gap-3 lg:rounded-[18px] lg:bg-card lg:p-4">
            <h2 className="mt-1 text-title lg:mt-0 lg:text-[21px] lg:leading-tight lg:font-semibold lg:tracking-[-0.02em]">
              Review {one ? "1 concept" : `${String(due.length)} concepts`} ·
              about {reviewMinutes(due.length)} min
            </h2>
            <p className="mt-3 text-ink lg:mt-0 lg:text-[13px] lg:font-medium lg:text-ink-muted">
              Due for review: can you still recall {one ? "this" : "these"}?
            </p>
          </div>
          <ol className="mt-3 flex flex-col gap-2 lg:mt-0">
            {due.slice(0, NAMED).map((concept, i) => (
              <li
                key={concept.name}
                className="flex items-center gap-3 rounded-2xl border border-hairline px-4 py-3 lg:gap-2.5 lg:rounded-none lg:border-0 lg:p-0"
              >
                <span
                  aria-hidden="true"
                  className="flex size-7 shrink-0 items-center justify-center rounded-full bg-(--review-tint) text-sm font-bold text-(--review-line) lg:size-6 lg:bg-card lg:text-xs"
                >
                  {i + 1}
                </span>
                <span className="flex min-w-0 flex-1 flex-col lg:flex-row lg:items-center lg:justify-between lg:gap-2.5">
                  <span className="font-semibold lg:text-sm">
                    {concept.name}
                  </span>
                  <span className="text-sm text-ink-muted lg:text-[13px] lg:font-semibold lg:text-ink-soft">
                    {recalled(concept.daysSince)}
                  </span>
                </span>
              </li>
            ))}
          </ol>
          {more > 0 ? (
            <p className="mt-2 text-sm text-ink-muted lg:mt-0">
              and {more} more
            </p>
          ) : null}
          <form
            action={startReviewAction}
            className="mt-auto flex pt-4 lg:pt-0"
          >
            <button
              type="submit"
              className="inline-flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-full bg-ink px-5 py-2.5 font-semibold text-page lg:h-[50px] lg:text-base"
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                className="hidden size-[13px] lg:block"
              >
                <path d="M7 4.5v15l12-7.5z" fill="currentColor" />
              </svg>
              Start quiz
            </button>
          </form>
        </div>
      </Card>
    </article>
  );
}

// Three cards fanned out, the middle one with lines of a question (owner's design,
// 2026-10-30), in the design system's Review family (cards, memory strength), the
// feed cards' picture band. Decorative.
function ReviewArt() {
  const c = (role: string) => `var(--review-${role})`;
  const card = (x: number, y: number, turn: number, fill: string) => (
    <rect
      x={x - 25}
      y={y - 28}
      width="50"
      height="56"
      rx="8"
      fill={fill}
      transform={`rotate(${String(turn)} ${String(x)} ${String(y)})`}
    />
  );
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 320 120"
      className="block h-36 w-full rounded-t-3xl sm:h-44 lg:hidden"
      style={{ background: c("tint") }}
    >
      {card(140, 64, -12, c("top"))}
      {card(160, 56, 0, c("left"))}
      <rect x="143" y="40" width="26" height="5" rx="2.5" fill="white" />
      <rect x="143" y="50" width="18" height="5" rx="2.5" fill="white" />
      {card(182, 62, 10, c("right"))}
    </svg>
  );
}
