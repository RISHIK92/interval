import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { TopicArt } from "./TopicArt";

// ADR-0049 (owner, 2026-11-25): software design's picture is a class diagram in its own
// colour family, not another topic's drawing.
test("software design is drawn as classes in its own colours", () => {
  const html = renderToStaticMarkup(<TopicArt topic="software-design" />);
  expect(html).toContain("var(--software-design-tint)");
  expect(html).toContain("<rect");
  expect(html).not.toMatch(/var\(--(backend|review)-/);
  expect(renderToStaticMarkup(<TopicArt topic="backend" />)).not.toContain(
    "<rect",
  );
});
