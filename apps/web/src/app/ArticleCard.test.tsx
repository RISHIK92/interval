import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import type { ArticleFeedCard } from "../server/ports";
import { ArticleCard } from "./ArticleCard";

// A whole article in the 8–15 chip (§3.2, Q-P1-16, Q-P1-39, P1-W4-S05b).
const card: ArticleFeedCard = {
  kind: "article",
  itemId: "5",
  estimatedMinutes: 12,
  articleTitle: "Consensus in practice",
  author: "Rae Writer",
  sourceName: "Example Engineering",
  note: null,
  saved: false,
  frameable: false,
};

function textOf(html: string): string {
  return html
    .replace(/<[^>]+>/g, "|")
    .split("|")
    .filter(Boolean)
    .join(" / ");
}

test("an article that fits says so, and links to the publisher's page", () => {
  const html = renderToStaticMarkup(
    <ArticleCard card={card} chip="8-15" position={1} hero controls={null} />,
  );
  expect(textOf(html)).toBe(
    "Example Engineering · Rae Writer / Consensus in practice / " +
      "Whole article · 12 min / Fits your 8–15 min break / Read article",
  );
  expect(html).toContain(
    'href="/out?item=5&amp;chip=8-15&amp;pos=1&amp;target=original"',
  );
  expect(html).toContain('rel="noopener noreferrer"');
});

test("a longer article shows its length and never claims to fit", () => {
  const html = renderToStaticMarkup(
    <ArticleCard
      card={{ ...card, estimatedMinutes: 22 }}
      chip="8-15"
      position={1}
      hero
      controls={null}
    />,
  );
  expect(textOf(html)).toContain("Whole article · 22 min");
  expect(html).not.toContain("Fits your");
});

test("an article with no countable text says its length is unknown", () => {
  const html = renderToStaticMarkup(
    <ArticleCard
      card={{ ...card, estimatedMinutes: null, author: null }}
      chip="8-15"
      position={1}
      hero
      controls={null}
    />,
  );
  expect(textOf(html)).toBe(
    "Example Engineering / Consensus in practice / " +
      "Whole article · Length unknown / Read article",
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
      position={1}
      hero
      controls={null}
    />,
  );
  expect(html).toMatch(
    /<div class="[^"]*border-dashed[^"]*">Why this matters: Pitched at your beginner level\. <span[^>]*>AI<\/span><\/div>/,
  );
});
