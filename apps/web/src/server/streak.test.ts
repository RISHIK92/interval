import { describe, expect, it } from "vitest";
import { dailyStreak } from "./streak";

// Consecutive UTC days from 2031-03-01.
const days = (from: number, to: number): string[] =>
  Array.from(
    { length: to - from + 1 },
    (_, i) => `2031-03-${String(from + i).padStart(2, "0")}`,
  );

describe("dailyStreak (Q-P3-07)", () => {
  it("counts consecutive days played", () => {
    expect(dailyStreak(days(1, 3), "2031-03-03")).toEqual({
      days: 3,
      freezes: 0,
    });
  });

  it("isn't broken by today not being played yet", () => {
    expect(dailyStreak(days(1, 3), "2031-03-04").days).toBe(3);
  });

  it("is nothing without a day played", () => {
    expect(dailyStreak([], "2031-03-04")).toEqual({ days: 0, freezes: 0 });
  });

  it("earns a freeze on the 7th day played, and holds at most 1", () => {
    expect(dailyStreak(days(1, 6), "2031-03-06").freezes).toBe(0);
    expect(dailyStreak(days(1, 7), "2031-03-07").freezes).toBe(1);
    expect(dailyStreak(days(1, 14), "2031-03-14").freezes).toBe(1);
  });

  it("spends a freeze on one missed day, which doesn't count", () => {
    const played = [...days(1, 7), ...days(9, 10)];
    expect(dailyStreak(played, "2031-03-10")).toEqual({ days: 9, freezes: 0 });
  });

  it("keeps a streak whose freeze covers yesterday, until today ends", () => {
    expect(dailyStreak(days(1, 7), "2031-03-09")).toEqual({
      days: 7,
      freezes: 0,
    });
  });

  it("resets after a missed day with no freeze", () => {
    expect(dailyStreak([...days(1, 3), ...days(5, 6)], "2031-03-06").days).toBe(
      2,
    );
    expect(dailyStreak(days(1, 3), "2031-03-05").days).toBe(0);
  });

  it("resets after two missed days and keeps the freeze held", () => {
    const played = [...days(1, 7), ...days(10, 11)];
    expect(dailyStreak(played, "2031-03-11")).toEqual({ days: 2, freezes: 1 });
    expect(dailyStreak(days(1, 7), "2031-03-10")).toEqual({
      days: 0,
      freezes: 1,
    });
  });

  it("counts days played overall toward the next freeze", () => {
    // 3, a gap that resets, then 4 more: the 7th day played earns one.
    const played = [...days(1, 3), ...days(6, 9)];
    expect(dailyStreak(played, "2031-03-09")).toEqual({ days: 4, freezes: 1 });
  });

  it("reads days in any order, once each", () => {
    expect(
      dailyStreak(["2031-03-02", "2031-03-01", "2031-03-02"], "2031-03-02"),
    ).toEqual({ days: 2, freezes: 0 });
  });
});
