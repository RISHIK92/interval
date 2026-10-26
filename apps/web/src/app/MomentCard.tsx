import type { ReactNode } from "react";
import { type Chip, chipLabel } from "../server/chips";
import type { MomentFeedCard } from "../server/ports";
import { outHref, readHref } from "../server/outbound";
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
        // A section at the top of its article carries the article's title: say it once.
        hero
          ? card.articleTitle === card.sectionTitle
            ? null
            : card.articleTitle
          : `${card.articleTitle === card.sectionTitle ? "" : `${card.articleTitle} · `}Section ${String(card.sectionNumber)} of ${String(card.sectionCount)}`
      }
      section={
        hero ? { number: card.sectionNumber, count: card.sectionCount } : null
      }
      length={`${String(card.estimatedMinutes)} min reading`}
      fits={`Fits your ${chipLabel(chip)} break`}
      note={card.note}
      read={{
        // ADR-0018: in Interval's reader when the publisher allows framing.
        href: card.frameable
          ? readHref(out)
          : outHref({ ...out, target: "section" }),
        label: "Read article",
        item: card.itemId,
        moment: card.momentId,
        inApp: card.frameable,
      }}
      originalHref={outHref({ ...out, target: "original" })}
      controls={controls}
    />
  );
}
