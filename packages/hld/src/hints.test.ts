import { describe, expect, test } from "vitest";
import { FRAGILE, LAVISH, SHORTENER, SOUND } from "./fixtures.test-helpers";
import { hints } from "./hints";
import { simulate } from "./simulate";

// P6-W39 (Q-P6-03): hints by rule from the preview simulation.
const of = (design: typeof SOUND) =>
  hints(SHORTENER, simulate(SHORTENER, design));

describe("hints", () => {
  test("a sound design gets none", () => {
    expect(of(SOUND)).toEqual([]);
  });

  test("an overloaded, single-zone design hears about both, the worst first", () => {
    const h = of(FRAGILE);
    expect(h[0]).toBe(
      'api is overloaded in "A normal day": it needs more capacity.',
    );
    expect(h).toContain(
      'In "A zone goes down", lb, api and db go down: nothing covers for them.',
    );
    expect(h.length).toBeLessThanOrEqual(5);
  });

  test("a design that serves nothing is told where requests stop", () => {
    const h = of({ ...SOUND, nodes: SOUND.nodes.slice(0, 1), edges: [] });
    expect(h).toEqual([
      '"read" requests aren\'t served: route them on to where the work is done.',
      '"write" requests aren\'t served: route them on to where the work is done.',
      "No write is kept: route writes to a database or store.",
    ]);
  });

  test("going over budget is a hint", () => {
    expect(of(LAVISH)).toContain(
      "The design is over budget: look for capacity it doesn't use.",
    );
  });
});
