import type { ReactNode } from "react";
import { type Chip, chipLabel } from "../server/chips";
import type { MomentFeedCard } from "../server/ports";
import { outHref } from "../server/outbound";
import { FeedCardLayout } from "./FeedCardLayout";

// A moment is a deep link into the publisher's page, never a copy (§3.2). Every card in
// a chip's feed fits that chip (Q-P1-16): the worker leaves out what doesn't.
export function MomentCard({
  card,
  chip,
  position,
  hero,
  controls,
}: {
  card: MomentFeedCard;
  chip: Chip;
  position: number;
  hero: boolean;
  controls: ReactNode;
}) {
  const out = {
    itemId: card.itemId,
    momentId: card.momentId,
    chip,
    from: { position },
  };
  return (
    <FeedCardLayout
      hero={hero}
      title={card.sectionTitle}
      attribution={
        card.author ? `${card.sourceName} · ${card.author}` : card.sourceName
      }
      context={
        hero
          ? card.articleTitle
          : `${card.articleTitle} · Section ${String(card.sectionNumber)} of ${String(card.sectionCount)}`
      }
      section={
        hero ? { number: card.sectionNumber, count: card.sectionCount } : null
      }
      length={`${String(card.estimatedMinutes)} min reading`}
      fits={`Fits your ${chipLabel(chip)} break`}
      note={card.note}
      read={{
        href: outHref({ ...out, target: "section" }),
        label: "Read on site",
        item: card.itemId,
        moment: card.momentId,
      }}
      originalHref={outHref({ ...out, target: "original" })}
      controls={controls}
    />
  );
}
