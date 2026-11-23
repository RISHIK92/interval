import { expect, test } from "vitest";
import { freeSpot } from "./placement";

// A node card is 120 px wide and under 90 px tall (flow.tsx's NODE_STYLE); two cards
// closer than this, both ways, overlap.
const CARD = { width: 130, height: 90 };
const overlaps = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.abs(a.x - b.x) < CARD.width && Math.abs(a.y - b.y) < CARD.height;

// A new component goes where it can be seen and clicked: never on another one.
test("in an empty design, the first component goes top left", () => {
  expect(freeSpot([])).toEqual({ x: 0, y: 0 });
});

test("a node where the canvas used to put them (off the grid) isn't covered", () => {
  const old = { x: 80, y: 60 };
  const spot = freeSpot([{ position: old }]);
  expect(overlaps(spot, old)).toBe(false);
});

test("a node with no position counts as top left", () => {
  expect(overlaps(freeSpot([{}]), { x: 0, y: 0 })).toBe(false);
});

test("components added one after another never overlap, among old ones too", () => {
  const nodes: { position: { x: number; y: number } }[] = [
    { position: { x: 80, y: 0 } },
    { position: { x: 120, y: 120 } },
    { position: { x: 200, y: 240 } },
  ];
  for (let i = 0; i < 20; i++) {
    const spot = freeSpot(nodes);
    for (const n of nodes) expect(overlaps(spot, n.position)).toBe(false);
    nodes.push({ position: spot });
  }
});
