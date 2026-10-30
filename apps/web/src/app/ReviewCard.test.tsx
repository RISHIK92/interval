import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { ReviewCard } from "./ReviewCard";

// P2-W9-S06: the review card says why it's here (§5B): each due concept and when it
// was last recalled, as quiz tiles (owner, 2026-10-30), three at most, then a count.
const due = (...days: (number | null)[]) =>
  days.map((daysSince, i) => ({ name: `C${String(i + 1)}`, daysSince }));
const words = (list: ReturnType<typeof due>) =>
  renderToStaticMarkup(<ReviewCard due={list} chip="3-8" />).replace(
    /<[^>]+>/g,
    "|",
  );

test("each due concept says when it was last recalled", () => {
  const w = words(due(0, 1, 6));
  expect(w).toContain("|C1||last recalled today|");
  expect(w).toContain("|C2||last recalled yesterday|");
  expect(w).toContain("|C3||last recalled 6 days ago|");
  // Numbered like a quiz's questions (owner, 2026-10-30), not question marks.
  expect(w).toMatch(/\|1\|+C1\|.*\|2\|+C2\|.*\|3\|+C3\|/);
  expect(w).not.toContain("|?|");
  expect(words(due(null))).toContain("|C1||not recalled yet|");
  expect(w).toContain("Due for review: can you still recall these?");
  expect(words(due(2))).toContain("can you still recall this?");
});

test("three are named, then the rest are counted", () => {
  const w = words(due(1, 1, 1, 1, 1));
  expect(w).toContain("C3");
  expect(w).not.toContain("C4");
  expect(w).toContain("and 2 more");
  expect(words(due(1, 1, 1))).not.toContain("more");
});

// Owner (2026-10-30): the card has the feed cards' shape, with a picture in the design
// system's Review family, decorative only.
test("the card leads with a Review-coloured picture, hidden from screen readers", () => {
  const html = renderToStaticMarkup(<ReviewCard due={due(1)} chip="3-8" />);
  expect(html).toMatch(/<svg aria-hidden="true"[^>]*var\(--review-tint\)/);
  expect(html.indexOf("<svg")).toBeLessThan(html.indexOf("Spaced review"));
});
