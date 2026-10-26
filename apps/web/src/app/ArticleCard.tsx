import { type Chip, chipLabel, chipLimit } from "../server/chips";
import type { ArticleFeedCard } from "../server/ports";
import { outHref } from "../server/outbound";
import { WhyNote } from "./WhyNote";

// A whole article, offered by the 8–15 chip (§3.2, Q-P1-16): a link to the publisher's
// page with its title and length, never its text. An article longer than the break is
// still offered (owner, 2026-10-26), so only one that fits says so.
export function ArticleCard({
  card,
  chip,
  position,
}: {
  card: ArticleFeedCard;
  chip: Chip;
  position: number;
}) {
  const attribution = card.author
    ? `${card.sourceName} · ${card.author}`
    : card.sourceName;
  const minutes = card.estimatedMinutes;
  const length = minutes === null ? "Length unknown" : `${String(minutes)} min`;
  return (
    <article>
      <h2>{card.articleTitle}</h2>
      <p>{`Whole article · ${length}`}</p>
      {minutes !== null && minutes <= chipLimit(chip) ? (
        <p>{`Fits your ${chipLabel(chip)} break`}</p>
      ) : null}
      <WhyNote note={card.note} />
      <p>{attribution}</p>
      <a
        href={outHref({
          itemId: card.itemId,
          chip,
          from: { position },
          target: "original",
        })}
        data-item={card.itemId}
        target="_blank"
        rel="noopener noreferrer"
      >
        Open original website
      </a>
    </article>
  );
}
