import type { Chip } from "../server/chips";
import { startReviewAction } from "./quiz/actions";
import { reviewMinutes } from "./reviewTime";
import { Card } from "./ui/Card";

const NAMED = 3; // then "and N more": more would outgrow the feed cards beside it

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
  chip,
}: {
  due: { name: string; daysSince: number | null }[];
  chip: Chip; // the quiz returns to this time chip's feed
}) {
  const one = due.length === 1;
  const more = due.length - NAMED;
  return (
    <article className="h-full">
      <Card className="flex h-full flex-col">
        <ReviewArt />
        <div className="flex flex-1 flex-col p-5">
          <p className="text-sm text-ink-muted">Spaced review</p>
          <h2 className="mt-1 text-title">
            Review {one ? "1 concept" : `${String(due.length)} concepts`} ·
            about {reviewMinutes(due.length)} min
          </h2>
          <p className="mt-3 text-ink">
            Due for review: can you still recall {one ? "this" : "these"}?
          </p>
          <ol className="mt-3 flex flex-col gap-2">
            {due.slice(0, NAMED).map((concept) => (
              <li
                key={concept.name}
                className="flex items-center gap-3 rounded-2xl border border-hairline px-4 py-3"
              >
                <span
                  aria-hidden="true"
                  className="flex size-7 shrink-0 items-center justify-center rounded-full bg-(--review-tint) text-sm font-bold text-(--review-line)"
                >
                  ?
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="font-semibold">{concept.name}</span>
                  <span className="text-sm text-ink-muted">
                    {recalled(concept.daysSince)}
                  </span>
                </span>
              </li>
            ))}
          </ol>
          {more > 0 ? (
            <p className="mt-2 text-sm text-ink-muted">and {more} more</p>
          ) : null}
          <form action={startReviewAction} className="mt-auto flex pt-4">
            <input type="hidden" name="chip" value={chip} />
            <button
              type="submit"
              className="inline-flex flex-1 cursor-pointer items-center justify-center rounded-full bg-ink px-5 py-2.5 font-semibold text-page"
            >
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
      className="block h-36 w-full rounded-t-3xl sm:h-44"
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
