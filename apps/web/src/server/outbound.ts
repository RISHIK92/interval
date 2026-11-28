// A card's link through /out (P1-W5-S01), which records the open and redirects. Only
// ids and the card's place go in it; the publisher URL is looked up there.
// A feed card has a position. A Continue link counts as continue_clicked and a Library
// link as an outbound click only (owner, 2026-10-26). An Explore link (ADR-0046) counts
// as a Library one does. ADR-0058: every link is the article's, so no section or chip.
export function outHref(link: {
  itemId: string;
  // "original": the reader's link to the publisher's own page.
  target: "article" | "original";
  // P7-W46: `via` "agent" marks a suggestion a companion surface showed.
  from:
    | { position: number; via?: "agent" }
    | "continue"
    | "library"
    | "reader"
    | "path"
    | "explore";
}): string {
  const query = new URLSearchParams({ item: link.itemId });
  if (typeof link.from === "string") {
    query.set("from", link.from);
  } else {
    query.set("pos", String(link.from.position));
    if (link.from.via !== undefined) query.set("via", link.from.via);
  }
  query.set("target", link.target);
  return `/out?${query.toString()}`;
}

// ADR-0018: a link into Interval's in-app reader, for a page that allows framing. /read
// records the open as /out does. "reader" is a move inside the reader (back after
// Save); "library" an open from the Library, which counts no feed event (owner,
// 2026-10-26); a path's reading names its path, to come back to (P2-W10-S03), and
// counts none either.
export function readHref(link: {
  itemId: string;
  from:
    | { position: number; via?: "agent" }
    | { path: string }
    | "continue"
    | "reader"
    | "library";
}): string {
  const query = new URLSearchParams();
  if (typeof link.from === "string") {
    query.set("from", link.from);
  } else if ("path" in link.from) {
    query.set("from", "path");
    query.set("path", link.from.path);
  } else {
    query.set("pos", String(link.from.position));
    if (link.from.via !== undefined) query.set("via", link.from.via);
  }
  return `/read/${link.itemId}?${query.toString()}`;
}
