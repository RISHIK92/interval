import { Diagram, describeDiagram } from "@interval/diagrams";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { DiagramSvg } from "./DiagramSvg";

// P4.5-W25-S01: the web draws the shared description as it is, in the theme's colours.
const diagram = Diagram.parse({
  title: "Every kind",
  shapes: [
    { id: "app", kind: "client", label: "App", at: { col: 0, row: 1 } },
    { id: "api", kind: "service", label: "API", at: { col: 4, row: 1 } },
    { id: "db", kind: "database", label: "DB", at: { col: 8, row: 1 } },
    { id: "hot", kind: "cache", label: "Cache", at: { col: 4, row: 4 } },
    { id: "q", kind: "queue", label: "Queue", at: { col: 8, row: 4 } },
    {
      id: "zone",
      kind: "group",
      label: "Zone",
      at: { col: 3, row: 0 },
      size: { cols: 8, rows: 7 },
    },
    { id: "tip", kind: "note", label: "Note", at: { col: 0, row: 4 } },
  ],
  arrows: [
    { from: "app", to: "api", label: "get" },
    { from: "api", to: "db", style: "dashed" },
  ],
});

test("an image named by its title, every element, the theme's colours", () => {
  const html = renderToStaticMarkup(
    <DiagramSvg description={describeDiagram(diagram)} />,
  );
  expect(html).toMatch(
    /^<svg role="img" aria-label="Every kind" viewBox="-20 -20 /,
  );
  expect(html).toContain("<title>Every kind</title>");
  expect(html).toContain('stroke="var(--ink)"');
  expect(html).toContain('fill="var(--well)"');
  expect(html).toContain('fill="none"');
  expect(html).toContain('stroke-dasharray="6 4"');
  // Every kind's label, and their outlines: the cylinder's lid, the cache's mark.
  for (const words of [
    "App",
    "API",
    "DB",
    "Cache",
    "Queue",
    "Zone",
    "Note",
    "get",
  ])
    expect(html).toContain(`>${words}</text>`);
  expect(html.match(/<ellipse /g)).toHaveLength(1);
  expect(html.match(/<polyline /g)).toHaveLength(1);
  expect(html).toContain('transform="translate(160 40)"');
  expect(html).toContain('dominant-baseline="central"');
});

test("labels stay text", () => {
  const sneaky = Diagram.parse({
    title: "T",
    shapes: [
      { id: "a", kind: "note", label: "<b>x</b>", at: { col: 0, row: 0 } },
    ],
    arrows: [],
  });
  const html = renderToStaticMarkup(
    <DiagramSvg description={describeDiagram(sneaky)} />,
  );
  expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
  expect(html).not.toContain("<b>");
});
