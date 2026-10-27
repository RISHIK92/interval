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
      <Card className="flex h-full flex-col gap-3 p-5">
        <p className="text-sm font-semibold text-ink-muted">Spaced review</p>
        <h2 className="text-title">
          Review {one ? "1 concept" : `${String(due.length)} concepts`} · about{" "}
          {reviewMinutes(due.length)} min
        </h2>
        <p className="text-ink-muted">
          Due for review: {named}. Recalling {one ? "it" : "them"} now keeps{" "}
          {one ? "it" : "them"}.
        </p>
        <Link
          href="/library#review-queue"
          className="mt-auto inline-flex items-center justify-center self-start rounded-full bg-ink px-5 py-2.5 font-semibold text-page"
        >
          Open review queue
        </Link>
      </Card>
    </article>
  );
}
