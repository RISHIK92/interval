import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import type { MomentFeedCard } from "../server/ports";
import { MomentCard } from "./MomentCard";

const card: MomentFeedCard = {
  kind: "moment",
  itemId: "70",
  momentId: "7",
  sectionTitle: "Raft in one page",
  sectionNumber: 2,
  sectionCount: 4,
  estimatedMinutes: 3,
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

test("links to the publisher's section in a new tab without leaking the opener", () => {
  const html = renderToStaticMarkup(
    <MomentCard card={card} chip="3-8" position={4} hero controls={null} />,
  );
  // Through /out, which records the open (P1-W5-S01); the URL is looked up there.
  expect(html).toContain(
    'href="/out?item=70&amp;moment=7&amp;chip=3-8&amp;pos=4&amp;target=section"',
  );
  expect(html).toContain(
    'href="/out?item=70&amp;moment=7&amp;chip=3-8&amp;pos=4&amp;target=original"',
  );
  expect(html).toContain('target="_blank"');
  expect(html).toContain('rel="noopener noreferrer"');
});

test("as the hero, renders only the card fields: attribution, title, article, position, length and fit", () => {
  const html = renderToStaticMarkup(
    <MomentCard card={card} chip="3-8" position={1} hero controls={null} />,
  );
  expect(textOf(html)).toBe(
    "Example Engineering · Rae Writer / Raft in one page / Consensus in practice / " +
      "Section 2 of 4 / 3 min reading / Fits your 3–8 min break / Read article / " +
      "Open original website",
  );
  // One progress segment per section (design screen 2): finished ones green, this one
  // light green and gently pulsing, the rest empty (owner, 2026-10-26).
  expect(html.match(/bg-go[\s"]/g)).toHaveLength(1);
  expect(html.match(/bg-go-soft motion-safe:animate-glow/g)).toHaveLength(1);
  expect(html.match(/bg-track/g)).toHaveLength(2);
});

// Rows sit under "Also fits in …", so they don't repeat the fit.
test("as a row, keeps the same links and fields without the fit", () => {
  const html = renderToStaticMarkup(
    <MomentCard
      card={card}
      chip="3-8"
      position={2}
      hero={false}
      controls={<button type="button">Menu</button>}
    />,
  );
  expect(textOf(html)).toBe(
    "Raft in one page / 3 min reading · Example Engineering · Rae Writer / " +
      "Consensus in practice · Section 2 of 4 / Read article / Open original website / Menu",
  );
  expect(html).toMatch(/<a[^>]*data-item="70"[^>]*data-moment="7"/);
});

test("omits the author when unknown", () => {
  const html = renderToStaticMarkup(
    <MomentCard
      card={{ ...card, author: null }}
      chip="1-3"
      position={1}
      hero
      controls={null}
    />,
  );
  expect(textOf(html)).toContain("Example Engineering / Raft in one page");
});

// P1-W4-S06: why this matters, labelled AI only once a model wrote it (AI-3, owner).
test("shows the card's note, with an AI label only when a model wrote it", () => {
  const template = renderToStaticMarkup(
    <MomentCard
      card={{ ...card, note: { text: "New this week.", ai: false } }}
      chip="3-8"
      position={1}
      hero
      controls={null}
    />,
  );
  expect(textOf(template)).toContain("Why this matters: New this week.");
  expect(template).not.toContain("<small>AI</small>");
  const polished = renderToStaticMarkup(
    <MomentCard
      card={{ ...card, note: { text: "Fresh, on your topic.", ai: true } }}
      chip="3-8"
      position={1}
      hero
      controls={null}
    />,
  );
  // In the dashed AI box, with its tag (AI-1).
  expect(polished).toMatch(
    /<div class="[^"]*border-dashed[^"]*">Why this matters: Fresh, on your topic\. <span[^>]*>AI<\/span><\/div>/,
  );
});

// Owner, 2026-10-26: a one-section article shows no progress bar, only its words.
test("a one-section moment shows no progress bar", () => {
  const html = renderToStaticMarkup(
    <MomentCard
      card={{ ...card, sectionNumber: 1, sectionCount: 1 }}
      chip="3-8"
      position={1}
      hero
      controls={null}
    />,
  );
  expect(html).toContain("Section 1 of 1");
  expect(html).not.toContain("bg-go");
});

// ADR-0018: a page that allows framing opens in Interval's reader, in this tab, with
// no data-item: the reader asks on close, not the tab's visibility.
test("a frameable section opens in the in-app reader; Open original still leaves", () => {
  const html = renderToStaticMarkup(
    <MomentCard
      card={{ ...card, frameable: true }}
      chip="3-8"
      position={4}
      hero
      controls={null}
    />,
  );
  expect(html).toMatch(
    // Marked for the Back prompt (ADR-0018), not for the tab-visibility one.
    /<a href="\/read\/70\?moment=7&amp;chip=3-8&amp;pos=4" data-read-item="70" data-read-moment="7" class="[^"]*">Read article<\/a>/,
  );
  expect(html).not.toContain("data-item");
  expect(html).toContain(
    'href="/out?item=70&amp;moment=7&amp;chip=3-8&amp;pos=4&amp;target=original" target="_blank"',
  );
});
