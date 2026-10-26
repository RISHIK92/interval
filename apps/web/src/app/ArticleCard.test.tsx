import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import type { ArticleFeedCard } from "../server/ports";
import { ArticleCard } from "./ArticleCard";

// A whole article in the 8–15 chip (§3.2, Q-P1-16, Q-P1-39, P1-W4-S05b).
const card: ArticleFeedCard = {
  kind: "article",
  itemId: "5",
  estimatedMinutes: 12,
  link: "https://webfeed.example.test/post",
  articleTitle: "Consensus in practice",
  author: "Rae Writer",
  sourceName: "Example Engineering",
  note: null,
};

function textOf(html: string): string {
  return html
    .replace(/<[^>]+>/g, "|")
    .split("|")
    .filter(Boolean)
    .join(" / ");
}

test("an article that fits says so, and links to the publisher's page", () => {
  const html = renderToStaticMarkup(<ArticleCard card={card} chip="8-15" />);
  expect(textOf(html)).toBe(
    "Consensus in practice / Whole article · 12 min / " +
      "Fits your 8–15 min break / Example Engineering · Rae Writer / Read on site",
  );
  expect(html).toContain('href="https://webfeed.example.test/post"');
  expect(html).toContain('rel="noopener noreferrer"');
});

test("a longer article shows its length and never claims to fit", () => {
  const html = renderToStaticMarkup(
    <ArticleCard card={{ ...card, estimatedMinutes: 22 }} chip="8-15" />,
  );
  expect(textOf(html)).toContain("Whole article · 22 min");
  expect(html).not.toContain("Fits your");
});

test("an article with no countable text says its length is unknown", () => {
  const html = renderToStaticMarkup(
    <ArticleCard
      card={{ ...card, estimatedMinutes: null, author: null }}
      chip="8-15"
    />,
  );
  expect(textOf(html)).toBe(
    "Consensus in practice / Whole article · Length unknown / " +
      "Example Engineering / Read on site",
  );
});

test("shows its note like a moment card does", () => {
  const html = renderToStaticMarkup(
    <ArticleCard
      card={{
        ...card,
        note: { text: "Pitched at your beginner level.", ai: true },
      }}
      chip="8-15"
    />,
  );
  expect(html).toContain(
    "<p>Why this matters: Pitched at your beginner level. <small>AI</small></p>",
  );
});
