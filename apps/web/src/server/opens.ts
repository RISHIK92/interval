import type { Chip } from "./chips";
import { events, progress } from "./container";
import type { EventContext } from "./events";
import type { OutboundLink } from "./ports";

// The publisher's page with utm_source=interval added (§8): appended as is, never
// re-encoding the publisher's own query, and before the fragment, so a section link
// still lands on its section. Null unless it is an http(s) URL: links come from feeds.
export function attributed(stored: string): string | null {
  let url: URL;
  try {
    url = new URL(stored);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const hash = stored.indexOf("#");
  const base = hash === -1 ? stored : stored.slice(0, hash);
  const fragment = hash === -1 ? "" : stored.slice(hash);
  return `${base}${base.includes("?") ? "&" : "?"}utm_source=interval${fragment}`;
}

// What an open records, whether it opened in the browser (/out) or in Interval's
// reader (/read, ADR-0018). A feed card has a chip and position; `from` names the
// other links: Continue, Library, a path's reading, or a move inside the reader.
export async function countOpen(
  context: EventContext,
  open: {
    itemId: string;
    momentId: string | undefined;
    link: OutboundLink;
    card: { chip: Chip; pos: number } | null;
    from: "continue" | "library" | "reader" | "path" | undefined;
    surface: "in_app" | "browser";
  },
): Promise<void> {
  const { itemId, momentId, link, card } = open;
  // A section the reader reached counts as read for continue cards (P1-W5-S03).
  if (momentId !== undefined && link.linkType !== "article") {
    await progress().recordOpen(context.userId, itemId, momentId);
  }
  if (card !== null) {
    // A feed card placed by exploration counts toward its arm (P1-W5-S03).
    await progress().countExploreOpen(
      context.userId,
      card.chip,
      itemId,
      momentId ?? null,
    );
    events().emit(
      "card_opened",
      {
        kind: momentId === undefined ? "article" : "moment",
        chip: card.chip,
        position: card.pos,
        // The ids, to match this open to a finish (P1-W6-S04). A link that landed
        // on the article is an article open: the article is what the reader can
        // finish, as the reading cookie says (owner, 2026-10-26).
        item_id: itemId,
        moment_id: link.linkType === "article" ? null : (momentId ?? null),
        surface: open.surface,
      },
      context,
    );
  } else if (open.from === "continue") {
    events().emit("continue_clicked", {}, context);
  }
}
