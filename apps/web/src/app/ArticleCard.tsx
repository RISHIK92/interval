import { type Chip, chipLabel, chipLimit } from "../server/chips";
import type { ArticleFeedCard } from "../server/ports";

// A whole article, offered by the 8–15 chip (§3.2, Q-P1-16): a link to the publisher's
// page with its title and length, never its text. An article longer than the break is
// still offered (owner, 2026-10-26), so only one that fits says so.
export function ArticleCard({
  card,
  chip,
}: {
  card: ArticleFeedCard;
  chip: Chip;
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
      <p>{attribution}</p>
      <a href={card.link} target="_blank" rel="noopener noreferrer">
        Read on site
      </a>
    </article>
  );
}
