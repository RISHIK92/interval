import type { Chip } from "../server/chips";
import { outHref } from "../server/outbound";
import type { ContinueCard } from "../server/ports";
import { continueAction } from "./finish/actions";

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
    <section aria-label="Continue reading">
      <h2>Continue reading</h2>
      <ul>
        {cards.map((card) => (
          <li key={card.itemId}>
            <a
              href={outHref({
                itemId: card.itemId,
                momentId: card.momentId,
                chip,
                from: "continue",
                target: "section",
              })}
              data-item={card.itemId}
              data-moment={card.momentId}
              target="_blank"
              rel="noopener noreferrer"
            >
              {`${card.sectionTitle} — ${card.articleTitle} · Section ${String(card.sectionNumber)} of ${String(card.sectionCount)}`}
            </a>
            <form action={continueAction}>
              <input type="hidden" name="itemId" value={card.itemId} />
              <input type="hidden" name="chip" value={chip} />
              <button type="submit" aria-label={`Dismiss ${card.articleTitle}`}>
                Dismiss
              </button>
            </form>
          </li>
        ))}
      </ul>
    </section>
  );
}
