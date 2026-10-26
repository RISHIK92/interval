import { type Chip, chipLabel } from "../server/chips";
import type { MomentFeedCard } from "../server/ports";
import { WhyNote } from "./WhyNote";

// A moment is a deep link into the publisher's page, never a copy (§3.2). Every card in
// a chip's feed fits that chip (Q-P1-16): the worker leaves out what doesn't.
export function MomentCard({
  card,
  chip,
}: {
  card: MomentFeedCard;
  chip: Chip;
}) {
  const attribution = card.author
    ? `${card.sourceName} · ${card.author}`
    : card.sourceName;
  return (
    <article>
      <h2>{card.sectionTitle}</h2>
      <p>
        {`Section ${String(card.sectionNumber)} of ${String(card.sectionCount)} · ${String(card.estimatedMinutes)} min`}
      </p>
      <p>{`Fits your ${chipLabel(chip)} break`}</p>
      <WhyNote note={card.note} />
      <p>{card.articleTitle}</p>
      <p>{attribution}</p>
      <a href={card.link} target="_blank" rel="noopener noreferrer">
        Read on site
      </a>
    </article>
  );
}
