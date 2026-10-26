import type { Chip } from "../server/chips";
import { outHref } from "../server/outbound";
import type { ContinueCard } from "../server/ports";
import { continueAction } from "./finish/actions";
import { SectionProgress } from "./SectionProgress";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";

// Continue cards (§3.2, §5C, Q-P1-40, P1-W5-S03): pinned above the feed in every chip
// (owner, 2026-10-26). The link is the next unread section; its open counts as
// continue_clicked, and the return prompt asks about it like any other card.
export function ContinueReading({
  cards,
  chip,
}: {
  cards: ContinueCard[];
  chip: Chip;
}) {
  if (cards.length === 0) return null;
  return (
    <section aria-label="Continue reading" className="my-6">
      <h2 className="text-section">Continue reading</h2>
      <ul className="mt-3 flex flex-col gap-3">
        {cards.map((card) => (
          <li key={card.itemId}>
            <Card className="p-4">
              <h3 className="font-semibold">{card.sectionTitle}</h3>
              <p className="text-sm text-ink-muted">{card.articleTitle}</p>
              <SectionProgress
                number={card.sectionNumber}
                count={card.sectionCount}
              />
              <div className="mt-3 flex items-center gap-2">
                {/* Every card says Continue, so the name says which; the visible
                    word leads it (WCAG 2.5.3). */}
                <a
                  href={outHref({
                    itemId: card.itemId,
                    momentId: card.momentId,
                    from: "continue",
                    target: "section",
                  })}
                  data-item={card.itemId}
                  data-moment={card.momentId}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Continue: ${card.sectionTitle} — ${card.articleTitle}`}
                  className="inline-flex items-center justify-center rounded-full bg-ink px-5 py-2.5 font-semibold text-page"
                >
                  Continue
                </a>
                <form action={continueAction}>
                  <input type="hidden" name="itemId" value={card.itemId} />
                  <input type="hidden" name="chip" value={chip} />
                  <Button
                    type="submit"
                    variant="secondary"
                    aria-label={`Dismiss ${card.articleTitle}`}
                  >
                    Dismiss
                  </Button>
                </form>
              </div>
            </Card>
          </li>
        ))}
      </ul>
    </section>
  );
}
