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
    | { from: "continue" | "library"; chip?: never }
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
