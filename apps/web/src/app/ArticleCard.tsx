import type { ReactNode } from "react";
import type { FeedCard } from "../server/ports";
import { outHref, readHref } from "../server/outbound";
import { stateLabel } from "./articleState";
import { FeedCardLayout } from "./FeedCardLayout";

// ADR-0058: every card is a whole article (§3.2): a link to the publisher's page with
// its title, source, reading time and state, never its text.
export function ArticleCard({
  card,
  position,
  controls,
  yourNote = null,
}: {
  card: FeedCard;
  position: number;
  controls: ReactNode;
  yourNote?: string | null;
}) {
  const minutes = card.estimatedMinutes;
  return (
    <FeedCardLayout
      title={card.articleTitle}
      attribution={
        card.author ? `${card.sourceName} · ${card.author}` : card.sourceName
      }
      length={
        minutes === null ? "Length unknown" : `${String(minutes)} min read`
      }
      state={stateLabel(card.state)}
      reasons={card.reasons}
      projectNote={card.projectNote}
      read={{
        // ADR-0018: in Interval's reader when the publisher allows framing.
        href: card.frameable
          ? readHref({ itemId: card.itemId, from: { position } })
          : outHref({
              itemId: card.itemId,
              from: { position },
              target: "article",
            }),
        label: "Read article",
        item: card.itemId,
        inApp: card.frameable,
      }}
      topic={card.topic}
      difficulty={card.difficulty}
      controls={controls}
      yourNote={yourNote}
    />
  );
}
