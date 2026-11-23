import { describe, expect, test } from "vitest";
import { drawVariant, matchProblem, problemBySlug } from "./match";
import { type Entry, rubricIncluded, speedPoints, standings } from "./score";

// P6-W42 (§6.4; Q-P6-06): an HLD match's score and its problem.
const start = new Date("2026-11-16T10:00:00Z");
const at = (minutes: number) => new Date(start.getTime() + minutes * 60_000);

describe("speed", () => {
  test("15 × the time left, only for a design past the baseline, never at the deadline", () => {
    expect(speedPoints(start, at(0), 30, true, false)).toBe(15);
    expect(speedPoints(start, at(10), 30, true, false)).toBe(10);
    expect(speedPoints(start, at(31), 30, true, false)).toBe(0);
    expect(speedPoints(start, at(5), 30, false, false)).toBe(0);
    expect(speedPoints(start, at(5), 30, true, true)).toBe(0);
  });
});

describe("standings", () => {
  const entry = (userId: string, e: Partial<Entry>): Entry => ({
    userId,
    simulation: 50,
    speed: 5,
    rubric: 20,
    baselinePassed: true,
    submittedAt: at(20),
    ...e,
  });

  test("the higher total first; a tie to the earlier submission; an exact tie shares", () => {
    const s = standings(
      [
        entry("a", { submittedAt: at(25) }),
        entry("b", { submittedAt: at(20) }),
        entry("c", { simulation: 60 }),
        entry("d", { submittedAt: at(20) }),
      ],
      true,
    );
    expect(s).toEqual([
      { userId: "c", total: 85, place: 1 },
      { userId: "b", total: 75, place: 2 },
      { userId: "d", total: 75, place: 2 },
      { userId: "a", total: 75, place: 4 },
    ]);
  });

  test("failing the baseline earns no rubric points, even if graded", () => {
    expect(
      standings([entry("a", { baselinePassed: false })], true)[0]?.total,
    ).toBe(55);
  });

  test("a missing judgement leaves the rubric out for everyone, scaled to 100", () => {
    const entries = [entry("a", {}), entry("b", { rubric: null })];
    expect(rubricIncluded(entries)).toBe(false);
    expect(standings(entries, false).map((s) => s.total)).toEqual([73.3, 73.3]);
    expect(
      rubricIncluded([entry("a", { baselinePassed: false, rubric: null })]),
    ).toBe(true);
  });
});

describe("a match's problem", () => {
  test("drawn from the pool, and rebuilt the same from its seed", () => {
    const { family, seed } = drawVariant("ai", () => 0.5, new Set());
    const others = drawVariant(
      "ai",
      () => 0.5,
      new Set([`${family}/${String(seed)}`]),
    );
    expect(others).not.toEqual({ family, seed });
    const problem = matchProblem(family, "ai", seed);
    expect(problem?.battleMode).toBe("ai");
    expect(matchProblem(family, "ai", seed)).toBe(problem);
    expect(matchProblem(family, "ai", 99_999)).toBeNull();
    expect(problemBySlug(`${family}-ai-${String(seed)}`)).toBe(problem);
    expect(problemBySlug("url-shortener")?.slug).toBe("url-shortener");
    expect(problemBySlug("nope-ai-1")).toBeNull();
  });
});
