import { expect, test } from "vitest";
import { wheelDecision } from "./FeedRow";

// A mouse wheel or a trackpad swipe over the feed row moves one card, then lets the
// page scroll at either end (owner, 2026-10-26: one swipe, one card).
const mid = { scrollLeft: 600, maxScroll: 1800, ctrlKey: false, deltaX: 0 };

test("a downward flick mid-row moves to the next card, upward to the previous", () => {
  expect(wheelDecision(0, { ...mid, deltaY: 100, timeStamp: 1000 })).toEqual({
    action: "move",
    step: 1,
    settledUntil: 1400,
  });
  expect(
    wheelDecision(0, { ...mid, deltaY: -100, timeStamp: 1000 }),
  ).toMatchObject({ action: "move", step: -1 });
});

test("the rest of one swipe is swallowed for as long as it keeps coming", () => {
  // Momentum events 300 ms apart keep the swipe going; each pushes the settle on.
  expect(wheelDecision(1400, { ...mid, deltaY: 40, timeStamp: 1300 })).toEqual({
    action: "swallow",
    settledUntil: 1700,
  });
  expect(wheelDecision(1700, { ...mid, deltaY: 10, timeStamp: 1600 })).toEqual({
    action: "swallow",
    settledUntil: 2000,
  });
  // A pause ends it: the next flick moves again.
  expect(
    wheelDecision(2000, { ...mid, deltaY: 100, timeStamp: 2100 }),
  ).toMatchObject({ action: "move", step: 1 });
});

test("at the ends, in a row that doesn't overflow, or sideways, the page has it", () => {
  const pass = { action: "pass" };
  expect(
    wheelDecision(0, { ...mid, deltaY: 100, scrollLeft: 1800, timeStamp: 1 }),
  ).toEqual(pass);
  expect(
    wheelDecision(0, { ...mid, deltaY: -100, scrollLeft: 0, timeStamp: 1 }),
  ).toEqual(pass);
  expect(
    wheelDecision(0, {
      ...mid,
      deltaY: 100,
      scrollLeft: 0,
      maxScroll: 0,
      timeStamp: 1,
    }),
  ).toEqual(pass);
  expect(
    wheelDecision(0, { ...mid, deltaX: 80, deltaY: 10, timeStamp: 1 }),
  ).toEqual(pass);
});

test("pinch-zoom and ctrl+wheel stay the browser's zoom", () => {
  expect(
    wheelDecision(0, { ...mid, deltaY: 100, ctrlKey: true, timeStamp: 1 }),
  ).toEqual({ action: "pass" });
});
