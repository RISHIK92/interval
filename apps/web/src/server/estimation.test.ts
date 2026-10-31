import { expect, test } from "vitest";
import { estimateScore, missed, points } from "./estimation";

// C-27 (ADR-0006): full points within 1.25× either way, falling linearly in log
// space to nothing at 10× off.
test("an answer within 1.25× either way scores in full", () => {
  expect(estimateScore(300, 300)).toBe(1);
  expect(estimateScore(375, 300)).toBe(1);
  expect(estimateScore(240, 300)).toBe(1);
  expect(estimateScore(299.9, 300)).toBe(1);
});

test("between 1.25× and 10× the score falls linearly in log space, the same both ways", () => {
  const expected =
    1 - (Math.log(3) - Math.log(1.25)) / (Math.log(10) - Math.log(1.25));
  expect(estimateScore(900, 300)).toBeCloseTo(expected, 10);
  expect(estimateScore(100, 300)).toBeCloseTo(expected, 10);
  expect(expected).toBeCloseTo(0.579, 3);
  expect(estimateScore(400, 300)).toBeLessThan(1);
  expect(estimateScore(400, 300)).toBeGreaterThan(estimateScore(900, 300));
});

test("10× off or more either way scores nothing", () => {
  expect(estimateScore(3000, 300)).toBe(0);
  expect(estimateScore(30, 300)).toBe(0);
  expect(estimateScore(15000, 300)).toBe(0);
  expect(estimateScore(6, 300)).toBe(0);
});

test("a guess that isn't a positive number scores nothing", () => {
  for (const guess of [0, -300, Number.NaN, Number.POSITIVE_INFINITY]) {
    expect(estimateScore(guess, 300)).toBe(0);
  }
});

// P3-W13-S04 (owner, 2026-10-31): up to 100 points an answer; under half points (about
// 3.5× off) sends the question's source back to reading.
test("points are the score out of 100, rounded", () => {
  expect(points(1)).toBe(100);
  expect(points(estimateScore(900, 300))).toBe(58);
  expect(points(0)).toBe(0);
});

test("under half points is missed; half or more isn't", () => {
  expect(missed(0.5)).toBe(false);
  expect(missed(0.49)).toBe(true);
  expect(missed(estimateScore(300 * 3.5, 300))).toBe(false);
  expect(missed(estimateScore(300 * 3.6, 300))).toBe(true);
});
