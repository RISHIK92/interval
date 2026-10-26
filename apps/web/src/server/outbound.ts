import type { Chip } from "./chips";

// A card's link through /out (P1-W5-S01), which records the open and redirects. Only
// ids and the card's place go in it; the publisher URL is looked up there.
// A Continue link after a finish has no feed position: it counts as continue_clicked.
export function outHref(link: {
  itemId: string;
  momentId?: string;
  chip: Chip;
  from: { position: number } | "continue";
  target: "section" | "original";
}): string {
  const query = new URLSearchParams({ item: link.itemId });
  if (link.momentId !== undefined) query.set("moment", link.momentId);
  query.set("chip", link.chip);
  if (link.from === "continue") query.set("from", "continue");
  else query.set("pos", String(link.from.position));
  query.set("target", link.target);
  return `/out?${query.toString()}`;
}
