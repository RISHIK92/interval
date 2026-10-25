import type { FeedCard } from "../server/feed";

// A moment is a deep link into the publisher's page, never a copy (§3.2).
export function MomentCard({ card }: { card: FeedCard }) {
  const attribution = card.author
    ? `${card.sourceName} · ${card.author}`
    : card.sourceName;
  return (
    <article>
      <h2>{card.sectionTitle}</h2>
      <p>
        {`Section ${String(card.sectionNumber)} of ${String(card.sectionCount)} · ${String(card.estimatedMinutes)} min`}
      </p>
      <p>{card.articleTitle}</p>
      <p>{attribution}</p>
      <a href={card.link} target="_blank" rel="noopener noreferrer">
        Read on site
      </a>
    </article>
  );
}
