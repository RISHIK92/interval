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
  reasons: null,
  projectNote: null,
  saved: false,
  frameable: false,
  topic: null,
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
    <MomentCard card={card} chip="3-8" position={4} controls={null} />,
  );
  // Through /out, which records the open (P1-W5-S01); the URL is looked up there.
  expect(html).toContain(
    'href="/out?item=70&amp;moment=7&amp;chip=3-8&amp;pos=4&amp;target=section"',
  );
  expect(html).toContain('target="_blank"');
  expect(html).toContain('rel="noopener noreferrer"');
});

test("renders only the card fields: attribution, title, article, position, length and fit", () => {
  const html = renderToStaticMarkup(
    <MomentCard card={card} chip="3-8" position={1} controls={null} />,
  );
  expect(textOf(html)).toBe(
    "Example Engineering · Rae Writer / Raft in one page / Consensus in practice / " +
      "Section 2 of 4 / 3 min reading / Read article",
  );
  // One progress segment per section (design screen 2): finished ones green, this one
  // light green and gently pulsing, the rest empty (owner, 2026-10-26).
  expect(html.match(/bg-go[\s"]/g)).toHaveLength(1);
  expect(html.match(/bg-go-soft motion-safe:animate-glow/g)).toHaveLength(1);
  expect(html.match(/bg-track/g)).toHaveLength(2);
});

test("omits the author when unknown", () => {
  const html = renderToStaticMarkup(
    <MomentCard
      card={{ ...card, author: null }}
      chip="1-3"
      position={1}
      controls={null}
    />,
  );
  expect(textOf(html)).toContain("Example Engineering / Raft in one page");
});

// ADR-0026: every card says why the ranking showed it, in the app's own words.
test("shows the card's reasons, never labelled AI", () => {
  const html = renderToStaticMarkup(
    <MomentCard
      card={{
        ...card,
        reasons: {
          text: "Shown for: your topics backend · 3 min",
          kinds: ["topic_match", "time_fit"],
        },
      }}
      chip="3-8"
      position={1}
      controls={null}
    />,
  );
  expect(textOf(html)).toContain("Shown for: your topics backend · 3 min");
  expect(html).not.toContain("border-dashed");
});

// Owner, 2026-10-26: a one-section article shows no progress bar, only its words.
test("a one-section moment shows no progress bar", () => {
  const html = renderToStaticMarkup(
    <MomentCard
      card={{ ...card, sectionNumber: 1, sectionCount: 1 }}
      chip="3-8"
      position={1}
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
      controls={null}
    />,
  );
  expect(html).toMatch(
    // Marked for the Back prompt (ADR-0018), not for the tab-visibility one.
    /<a href="\/read\/70\?moment=7&amp;chip=3-8&amp;pos=4" data-read-item="70" data-read-moment="7" class="[^"]*">Read article<\/a>/,
  );
  expect(html).not.toContain("data-item");
});

// P2-W7-S04: the user's own note on this section, a line on its card.
test("a card with the user's note shows it, and one without shows nothing", () => {
  const html = renderToStaticMarkup(
    <MomentCard
      card={card}
      chip="3-8"
      position={4}
      controls={null}
      yourNote="Terms are epochs"
    />,
  );
  expect(textOf(html)).toMatch(/Your note: +\/ Terms are epochs/);
  expect(
    renderToStaticMarkup(
      <MomentCard card={card} chip="3-8" position={4} controls={null} />,
    ),
  ).not.toContain("Your note");
});

// P2-W12-S05, ADR-0026 (AI-1, AI-3): the user's project line, labelled AI and naming
// the repository, sits under the reasons.
test("a project note shows under the reasons, in an AI box naming the repository", () => {
  const html = renderToStaticMarkup(
    <MomentCard
      card={{
        ...card,
        reasons: { text: "Shown for: your project", kinds: ["project_match"] },
        projectNote: {
          text: "Velox elects its leader the same way.",
          repositories: ["octo/velox"],
        },
      }}
      chip="3-8"
      position={1}
      controls={null}
    />,
  );
  expect(textOf(html)).toContain("Shown for: your project");
  expect(html).toMatch(
    /<div class="[^"]*border-dashed[^"]*"><span class="font-semibold">For your project octo\/velox:<\/span> Velox elects its leader the same way\. <span[^>]*>AI<\/span><\/div>/,
  );
});

// ADR-0026: a card where no reason counted shows no line.
test("a card with no reasons and no project line shows no explanation", () => {
  const html = renderToStaticMarkup(
    <MomentCard card={card} chip="3-8" position={1} controls={null} />,
  );
  expect(textOf(html)).not.toContain("Shown for");
  expect(html).not.toContain("border-dashed");
});
