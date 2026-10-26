import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import type { FeedCard } from "../server/ports";
import { MomentCard } from "./MomentCard";

const card: FeedCard = {
  momentId: "7",
  sectionTitle: "Raft in one page",
  sectionNumber: 2,
  sectionCount: 4,
  estimatedMinutes: 3,
  link: "https://webfeed.example.test/post#raft",
  articleTitle: "Consensus in practice",
  author: "Rae Writer",
  sourceName: "Example Engineering",
};

function textOf(html: string): string {
  return html
    .replace(/<[^>]+>/g, "|")
    .split("|")
    .filter(Boolean)
    .join(" / ");
}

test("links to the publisher's section in a new tab without leaking the opener", () => {
  const html = renderToStaticMarkup(<MomentCard card={card} chip="3-8" />);
  expect(html).toContain('href="https://webfeed.example.test/post#raft"');
  expect(html).toContain('target="_blank"');
  expect(html).toContain('rel="noopener noreferrer"');
});

test("renders only the card fields: title, position, fit, article and attribution", () => {
  const html = renderToStaticMarkup(<MomentCard card={card} chip="3-8" />);
  expect(textOf(html)).toBe(
    "Raft in one page / Section 2 of 4 · 3 min / Fits your 3–8 min break / " +
      "Consensus in practice / Example Engineering · Rae Writer / Read on site",
  );
});

test("omits the author when unknown", () => {
  const html = renderToStaticMarkup(
    <MomentCard card={{ ...card, author: null }} chip="1-3" />,
  );
  expect(textOf(html)).toContain(" / Example Engineering / Read on site");
});
