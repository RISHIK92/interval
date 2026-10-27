import { expect, test } from "vitest";
import { fsrsState, rate } from "./reviews";

// FSRS review cards (PER-2, Q-P2-16, P2-W9-S04): one rating per concept per quiz.
const DAY = 86_400_000;
const now = new Date("2026-10-28T10:00:00Z");

test("a first right rating schedules the concept days ahead, not minutes", () => {
  const card = rate(null, true, now);
  expect(card.reps).toBe(1);
  expect(card.lapses).toBe(0);
  expect(card.lastReview).toEqual(now);
  // Short-term steps off (suggested default): concepts come back in days.
  expect(card.due.getTime() - now.getTime()).toBeGreaterThanOrEqual(DAY);
});

test("a wrong rating comes due sooner than a right one", () => {
  const right = rate(null, true, now);
  const wrong = rate(null, false, now);
  expect(wrong.due.getTime()).toBeLessThan(right.due.getTime());
});

test("right again at the due date spaces it further; wrong counts a lapse", () => {
  const first = rate(null, true, now);
  const second = rate(first, true, first.due);
  expect(second.reps).toBe(2);
  expect(second.due.getTime() - first.due.getTime()).toBeGreaterThan(
    first.due.getTime() - now.getTime(),
  );
  const missed = rate(second, false, second.due);
  expect(missed.lapses).toBe(1);
  expect(missed.due.getTime() - second.due.getTime()).toBeLessThan(
    second.due.getTime() - first.due.getTime(),
  );
});

test("a stored state reads back as FSRS's, and nothing else does", () => {
  expect([0, 1, 2, 3].map(fsrsState)).toEqual([0, 1, 2, 3]);
  expect(() => fsrsState(4)).toThrow("unknown FSRS state 4");
});
