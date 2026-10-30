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
              Start review
            </button>
          </form>
        </div>
      </Card>
    </article>
  );
}

// A stack of cards and one coming back round to be recalled, in the design system's
// Review family (cards, memory strength), the feed cards' picture band. Decorative.
function ReviewArt() {
  const c = (role: string) => `var(--review-${role})`;
  // An isometric card: top face, then its two thin edges.
  const card = (x: number, y: number, a: number, b: number) => (
    <g key={`${String(x)}-${String(y)}`}>
      <path
        d={`M${String(x)} ${String(y)} l${String(a)} ${String(b)} l${String(-a)} ${String(b)} l${String(-a)} ${String(-b)}z`}
        fill={c("top")}
      />
      <path
        d={`M${String(x - a)} ${String(y + b)} l${String(a)} ${String(b)} v5 l${String(-a)} ${String(-b)}z`}
        fill={c("left")}
      />
      <path
        d={`M${String(x + a)} ${String(y + b)} l${String(-a)} ${String(b)} v5 l${String(a)} ${String(-b)}z`}
        fill={c("right")}
      />
    </g>
  );
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 320 120"
      className="block h-36 w-full rounded-t-3xl sm:h-44"
      style={{ background: c("tint") }}
    >
      {[60, 48, 36].map((y) => card(115, y, 44, 24))}
      <path
        d="M170 78 C 215 100, 262 82, 248 48"
        stroke={c("line")}
        strokeWidth="3"
        strokeDasharray="2 8"
        strokeLinecap="round"
        fill="none"
      />
      {card(232, 18, 28, 15)}
    </svg>
  );
}
