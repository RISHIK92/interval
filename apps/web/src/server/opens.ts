import { events, progress } from "./container";
import type { EventContext } from "./events";

// The publisher's page with utm_source=interval added (§8): appended as is, never
// re-encoding the publisher's own query, and before the fragment, so a link with a
// fragment still lands on it. Null unless it is an http(s) URL: links come from feeds.
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
// reader (/read, ADR-0018). A feed card has a position; `from` names the other links:
// Continue, Library, a path's reading, or a move inside the reader.
export async function countOpen(
  context: EventContext,
  open: {
    itemId: string;
    // `via`: offered by Home's feed, or by a companion surface (P7-W46).
    card: { pos: number; via: "feed" | "agent" } | null;
    from: "continue" | "library" | "reader" | "path" | "explore" | undefined;
    surface: "in_app" | "browser";
  },
): Promise<void> {
  const { itemId, card } = open;
  // ADR-0058: any open makes the article Continue reading until it is completed.
  await progress().recordOpen(context.userId, itemId);
  if (card !== null) {
    // A feed card placed by exploration counts toward its arm (P1-W5-S03).
    await progress().countExploreOpen(context.userId, itemId);
    events().emit(
      "card_opened",
      {
        position: card.pos,
        // The id, to match this open to a completion (P1-W6-S04).
        item_id: itemId,
        surface: open.surface,
        via: card.via,
      },
      context,
    );
  } else if (open.from === "continue") {
    events().emit("continue_clicked", {}, context);
  }
}
