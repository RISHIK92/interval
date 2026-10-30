import Link from "next/link";
import { reviewMinutes } from "./reviewTime";
import { Card } from "./ui/Card";

// P2-W9-S06 (Q-P2-17, REC-1 "due reviews"): the feed's second card when anything is
// due, linking to the Library's review queue. Like every card, it says why it's here
// (§5B).
export function ReviewCard({ due }: { due: { name: string }[] }) {
  const shown = due.slice(0, 3).map((c) => c.name);
  const more = due.length - shown.length;
  const named =
    more > 0
      ? `${shown.join(", ")} and ${String(more)} more`
      : shown.length > 1
        ? `${shown.slice(0, -1).join(", ")} and ${shown.at(-1) ?? ""}`
        : (shown[0] ?? "");
  const one = due.length === 1;
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
            Due for review: {named}. Recalling {one ? "it" : "them"} now keeps{" "}
            {one ? "it" : "them"}.
          </p>
          <div className="mt-auto flex pt-4">
            <Link
              href="/library#review-queue"
              className="inline-flex flex-1 items-center justify-center rounded-full bg-ink px-5 py-2.5 font-semibold text-page"
            >
              Open review queue
            </Link>
          </div>
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
