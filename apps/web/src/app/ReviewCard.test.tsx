import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { ReviewCard } from "./ReviewCard";

// P2-W9-S06: the review card names what is due, as a reader would say it.
const names = (...list: string[]) => list.map((name) => ({ name }));
const words = (due: { name: string }[]) =>
  renderToStaticMarkup(<ReviewCard due={due} />).replace(/<[^>]+>/g, "");

test("one, two, three and more concepts read naturally", () => {
  expect(words(names("Raft"))).toContain(
    "Due for review: Raft. Recalling it now keeps it.",
  );
  expect(words(names("Raft", "Quorum"))).toContain(
    "Due for review: Raft and Quorum. Recalling them",
  );
  expect(words(names("Raft", "Quorum", "MVCC"))).toContain(
    "Due for review: Raft, Quorum and MVCC.",
  );
  expect(words(names("Raft", "Quorum", "MVCC", "Indexes", "WAL"))).toContain(
    "Due for review: Raft, Quorum, MVCC and 2 more.",
  );
});

// Owner (2026-10-30): the card has the feed cards' shape, with a picture in the design
// system's Review family, decorative only.
test("the card leads with a Review-coloured picture, hidden from screen readers", () => {
  const html = renderToStaticMarkup(<ReviewCard due={names("Raft")} />);
  expect(html).toMatch(/<svg aria-hidden="true"[^>]*var\(--review-tint\)/);
  expect(html.indexOf("<svg")).toBeLessThan(html.indexOf("Spaced review"));
});
