import type { Chip } from "./chips";

// A card's link through /out (P1-W5-S01), which records the open and redirects. Only
// ids and the card's place go in it; the publisher URL is looked up there.
export function outHref(link: {
  itemId: string;
  momentId?: string;
  chip: Chip;
  position: number;
  target: "section" | "original";
}): string {
  const query = new URLSearchParams({ item: link.itemId });
  if (link.momentId !== undefined) query.set("moment", link.momentId);
  query.set("chip", link.chip);
  query.set("pos", String(link.position));
  query.set("target", link.target);
  return `/out?${query.toString()}`;
}
