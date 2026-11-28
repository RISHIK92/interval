import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import type { FeedCard } from "../server/ports";
import { ArticleCard } from "./ArticleCard";

// ADR-0058: every card is a whole article (§3.2, Q-P1-39).
const card: FeedCard = {
  itemId: "5",
  estimatedMinutes: 12,
  articleTitle: "Consensus in practice",
  author: "Rae Writer",
  sourceName: "Example Engineering",
  reasons: null,
  projectNote: null,
  saved: false,
  frameable: false,
  topic: null,
  difficulty: null,
  state: "unread",
};

function textOf(html: string): string {
  return html
    .replace(/<[^>]+>/g, "|")
    .split("|")
    .filter(Boolean)
    .join(" / ");
}

test("an article shows its length and links to the publisher's page", () => {
  const html = renderToStaticMarkup(
    <ArticleCard card={card} position={1} controls={null} />,
  );
  expect(textOf(html)).toBe(
    "Example Engineering · Rae Writer / Consensus in practice / " +
      "12 min read / Read article",
  );
  expect(html).toContain('href="/out?item=5&amp;pos=1&amp;target=article"');
  expect(html).toContain('rel="noopener noreferrer"');
});

test("a longer article shows its length", () => {
  const html = renderToStaticMarkup(
    <ArticleCard
      card={{ ...card, estimatedMinutes: 22 }}

      position={1}
      controls={null}
    />,
  );
  expect(textOf(html)).toContain("22 min read");
  expect(html).not.toContain("Fits your");
});

test("an article with no countable text says its length is unknown", () => {
  const html = renderToStaticMarkup(
    <ArticleCard
      card={{ ...card, estimatedMinutes: null, author: null }}

      position={1}
      controls={null}
    />,
  );
  expect(textOf(html)).toBe(
    "Example Engineering / Consensus in practice / " +
      "Length unknown / Read article",
  );
});

test("shows its reasons", () => {
  const html = renderToStaticMarkup(
    <ArticleCard
      card={{
        ...card,
        reasons: { text: "Worth a look.", kinds: [] },
      }}

      position={1}
      controls={null}
    />,
  );
  expect(textOf(html)).toContain("Worth a look.");
  expect(html).not.toContain("border-dashed"); // the app's words, not AI
});

// ADR-0018: a page that allows framing opens in Interval's reader, in this tab.
test("a frameable article opens in the in-app reader without a new tab", () => {
  const html = renderToStaticMarkup(
    <ArticleCard
      card={{ ...card, frameable: true }}

      position={2}
      controls={null}
    />,
  );
  expect(html).toContain('href="/read/5?pos=2"');
  expect(html).not.toContain("target=");
  expect(html).not.toContain("data-item");
});

// P2-W7-S04: the user's note on the whole article, a line on its card.
test("an article card shows the user's note on the article", () => {
  const html = renderToStaticMarkup(
    <ArticleCard
      card={card}

      position={1}
      controls={null}
      yourNote="Read the Raft part twice"
    />,
  );
  expect(textOf(html)).toMatch(/Your note: +\/ Read the Raft part twice/);
});

// ADR-0058: an article opened and not completed says so on its card.
test("an article opened and not completed shows Continue reading", () => {
  const html = renderToStaticMarkup(
    <ArticleCard
      card={{ ...card, state: "continue_reading" }}
      position={1}
      controls={null}
    />,
  );
  expect(textOf(html)).toBe(
    "Example Engineering · Rae Writer / Consensus in practice / " +
      "12 min read / Continue reading / Read article",
  );
});
