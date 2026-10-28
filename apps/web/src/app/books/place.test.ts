import { expect, test } from "vitest";
import { fractionOf, placeKeeper, scrollFor } from "./place";

// P2-W11-S04: a place in a session as a fraction of its scroll, and back.
test("the fraction is how far down the page can scroll, within 0 and 1", () => {
  expect(fractionOf(0, 3000, 800)).toBe(0);
  expect(fractionOf(1100, 3000, 800)).toBe(0.5);
  expect(fractionOf(2200, 3000, 800)).toBe(1);
  expect(fractionOf(9999, 3000, 800)).toBe(1);
  // Shorter than the window: nowhere to scroll.
  expect(fractionOf(0, 600, 800)).toBe(0);
});

test("a fraction goes back to the same scroll, on another screen size too", () => {
  expect(scrollFor(0.5, 3000, 800)).toBe(1100);
  expect(scrollFor(0.5, 4000, 600)).toBe(1700);
  expect(scrollFor(1, 600, 800)).toBe(0);
});

test("nothing is saved until the reader scrolls; then once, after it settles", () => {
  const saved: number[] = [];
  const timers = new Map<number, () => void>();
  let next = 1;
  const keeper = placeKeeper({
    save: (f) => saved.push(f),
    settleMs: 1000,
    schedule: (run) => {
      timers.set(next, run);
      return next++;
    },
    cancel: (t) => timers.delete(t),
  });
  // Opening (and leaving) without scrolling saves nothing.
  keeper.leaving();
  expect(saved).toEqual([]);
  keeper.scrolled(0.2);
  keeper.scrolled(0.3);
  expect(timers.size).toBe(1); // the earlier wait was replaced
  for (const [t, run] of [...timers]) {
    timers.delete(t);
    run();
  }
  expect(saved).toEqual([0.3]);
  // Leaving after a scroll saves where it ended, at once.
  keeper.scrolled(0.6);
  keeper.leaving();
  expect(saved).toEqual([0.3, 0.6]);
  expect(timers.size).toBe(0);
});
