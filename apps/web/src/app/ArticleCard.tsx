import type { ReactNode } from "react";
import { type Chip, chipLabel, chipLimit } from "../server/chips";
import type { ArticleFeedCard } from "../server/ports";
import { outHref, readHref } from "../server/outbound";
import { FeedCardLayout } from "./FeedCardLayout";

// A whole article, offered by the 8–15 chip (§3.2, Q-P1-16): a link to the publisher's
// page with its title and length, never its text. An article longer than the break is
// still offered (owner, 2026-10-26), so only one that fits says so.
export function ArticleCard({
  card,
  chip,
  position,
  hero,
  controls,
}: {
  card: ArticleFeedCard;
  chip: Chip;
  position: number;
  hero: boolean;
  controls: ReactNode;
}) {
  const minutes = card.estimatedMinutes;
  const length = minutes === null ? "Length unknown" : `${String(minutes)} min`;
  return (
    <FeedCardLayout
      hero={hero}
      title={card.articleTitle}
      attribution={
        card.author ? `${card.sourceName} · ${card.author}` : card.sourceName
      }
      context={null}
      section={null}
      length={`Whole article · ${length}`}
      fits={
        minutes !== null && minutes <= chipLimit(chip)
          ? `Fits your ${chipLabel(chip)} break`
          : null
      }
      note={card.note}
      read={{
        // ADR-0018: in Interval's reader when the publisher allows framing.
        href: card.frameable
          ? readHref({ itemId: card.itemId, chip, from: { position } })
          : outHref({
              itemId: card.itemId,
              chip,
              from: { position },
              target: "original",
            }),
        // Still the publisher's page, from the top (owner, 2026-10-26).
        label: "Read article",
        item: card.itemId,
        inApp: card.frameable,
      }}
      originalHref={null}
      controls={controls}
    />
  );
}
