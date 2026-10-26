import type { Chip } from "./chips";

// A card's link through /out (P1-W5-S01), which records the open and redirects. Only
// ids and the card's place go in it; the publisher URL is looked up there.
// A feed card has a chip and position. A Continue link counts as continue_clicked and
// a Library link as an outbound click only (owner, 2026-10-26); neither needs a chip.
export function outHref(
  link: {
    itemId: string;
    momentId?: string;
    target: "section" | "original";
  } & (
    | { from: { position: number }; chip: Chip }
    | { from: "continue" | "library" | "reader"; chip?: never }
  ),
): string {
  const query = new URLSearchParams({ item: link.itemId });
  if (link.momentId !== undefined) query.set("moment", link.momentId);
  if (typeof link.from === "string") {
    query.set("from", link.from);
  } else {
    query.set("chip", link.chip);
    query.set("pos", String(link.from.position));
  }
  query.set("target", link.target);
  return `/out?${query.toString()}`;
}

// ADR-0018: a link into Interval's in-app reader, for a page that allows framing. /read
// records the open as /out does; the chip takes the reader back to the same feed.
// "reader" is a move inside the reader (Next section, or back after Save); "library"
// an open from the Library, which counts no feed event (owner, 2026-10-26).
export function readHref(link: {
  itemId: string;
  momentId?: string;
  chip: Chip;
  from: { position: number } | "continue" | "reader" | "library";
}): string {
  const query = new URLSearchParams();
  if (link.momentId !== undefined) query.set("moment", link.momentId);
  query.set("chip", link.chip);
  if (typeof link.from === "string") {
    query.set("from", link.from);
  } else {
    query.set("pos", String(link.from.position));
  }
  return `/read/${link.itemId}?${query.toString()}`;
}
