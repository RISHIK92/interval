import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { FRAGILE, SHORTENER, SOUND } from "./fixtures.test-helpers";
import {
  calibrationCandidates,
  JudgeInput,
  judgeInput,
  rubricPoints,
} from "./judge";
import { simulate } from "./simulate";

// P6-W41 (CANVAS-6, AI-5; Q-P6-05): the judge's input, rubric points, and the
// calibration set.
describe("rubric points", () => {
  const rubric = [
    { id: "a", criterion: "A", weight: 1 },
    { id: "b", criterion: "B", weight: 3 },
  ];
  test("25 × the weighted mean level over 4", () => {
    const level = (n: number) => ({ level: n, reason: "" });
    expect(rubricPoints(rubric, { a: level(4), b: level(4) })).toBe(25);
    expect(rubricPoints(rubric, { a: level(4), b: level(0) })).toBe(6.3);
    expect(rubricPoints(rubric, { a: level(2), b: level(2) })).toBe(12.5);
  });
  test("a criterion without a level counts as 0", () => {
    expect(rubricPoints(rubric, { a: { level: 4, reason: "" } })).toBe(6.3);
  });
});

test("the judge gets the design and its numbers, never the client or anything unseen", () => {
  const input = judgeInput(SHORTENER, SOUND, simulate(SHORTENER, SOUND));
  expect(JudgeInput.parse(input)).toEqual(input);
  expect(input.components.map((c) => c.id)).toEqual([
    "lb",
    "api",
    "cache",
    "db",
  ]);
  expect(input.connections[0]).toEqual({
    from: "users",
    to: "lb",
    carries: ["read", "write"],
  });
  expect(input.simulation).toMatchObject({
    points: 60,
    baselinePassed: true,
    budgetPerMonth: 6_000,
  });
  expect(
    judgeInput(SHORTENER, FRAGILE, simulate(SHORTENER, FRAGILE)).simulation
      .baselinePassed,
  ).toBe(false);
});

describe("the calibration set", () => {
  const candidates = calibrationCandidates();
  test("about 50 designs, six per family, each id once", () => {
    expect(candidates).toHaveLength(48);
    expect(new Set(candidates.map((c) => c.id)).size).toBe(48);
  });
  test("each family has one design whose note tries to steer the judge", () => {
    const injected = candidates.filter((c) => c.label === "injection");
    expect(injected).toHaveLength(8);
    for (const c of injected)
      expect(c.input.components.some((x) => x.note.startsWith("SYSTEM:"))).toBe(
        true,
      );
  });
  test("calibration.json, which the worker's eval reads, is current", () => {
    const file = JSON.parse(
      readFileSync(join(import.meta.dirname, "calibration.json"), "utf8"),
    ) as unknown;
    expect(file).toEqual(JSON.parse(JSON.stringify(candidates)));
  });
});
