import { expect, test } from "vitest";
import { type BankQuestion, levelFor, pickRounds } from "./live-questions";

// P3-W16-S03 (MATCH-4, Q-P3-15; owner, 2026-11-03): shared concepts first, then either
// player's goal concepts, then any; at the pair's level, filled from the nearest.
const q = (
  id: number,
  level: BankQuestion["level"],
  concepts: string[],
): BankQuestion => ({
  question: String(id),
  stem: `Q${String(id)}?`,
  options: ["a", "b", "c", "d"],
  correct: 0,
  level,
  concepts,
});
const fixed = () => 0.5;
const ids = (rounds: BankQuestion[]) => rounds.map((r) => r.question);

test.each([
  [1399, "beginner"],
  [1400, "intermediate"],
  [1500, "intermediate"],
  [1700, "intermediate"],
  [1701, "advanced"],
] as const)("an average of %i plays %s", (rating, level) => {
  expect(levelFor(rating)).toBe(level);
});

test("shared concepts first, then goal concepts, then anything", () => {
  const bank = [
    q(1, "intermediate", ["any"]),
    q(2, "intermediate", ["goal"]),
    q(3, "intermediate", ["shared"]),
    q(4, "intermediate", ["shared", "goal"]),
    q(5, "intermediate", ["other"]),
  ];
  const picked = pickRounds(
    bank,
    { shared: new Set(["shared"]), goals: new Set(["goal"]) },
    "intermediate",
    4,
    fixed,
  );
  expect(ids(picked).slice(0, 2).sort()).toEqual(["3", "4"]);
  expect(ids(picked)[2]).toBe("2");
  expect(picked).toHaveLength(4);
  expect(new Set(ids(picked)).size).toBe(4);
});

test("no overlap: goal concepts, then the general pool; neither: the pool", () => {
  const bank = [q(1, "intermediate", ["x"]), q(2, "intermediate", ["goal"])];
  expect(
    ids(
      pickRounds(
        bank,
        { shared: new Set(), goals: new Set(["goal"]) },
        "intermediate",
        2,
        fixed,
      ),
    ),
  ).toEqual(["2", "1"]);
  expect(
    pickRounds(
      bank,
      { shared: new Set(), goals: new Set() },
      "intermediate",
      2,
      fixed,
    ),
  ).toHaveLength(2);
});

test("the pair's level first, a thin level filled from the nearest", () => {
  const bank = [
    q(1, "advanced", ["s"]),
    q(2, "beginner", ["s"]),
    q(3, "intermediate", ["s"]),
    q(4, "advanced", ["s"]),
  ];
  const tiers = { shared: new Set(["s"]), goals: new Set<string>() };
  // Beginner: beginner, then intermediate (one step), then advanced (two).
  expect(ids(pickRounds(bank, tiers, "beginner", 4, fixed))).toEqual([
    "2",
    "3",
    "1",
    "4",
  ]);
  // Intermediate: itself, then the three one step away.
  const inter = ids(pickRounds(bank, tiers, "intermediate", 4, fixed));
  expect(inter[0]).toBe("3");
  expect(inter.slice(1).sort()).toEqual(["1", "2", "4"]);
  // Level counts within a tier, never above it: a shared advanced question beats a
  // goal intermediate one.
  const withGoal = [...bank, q(9, "intermediate", ["g"])];
  const picked = ids(
    pickRounds(
      withGoal,
      { shared: new Set(["s"]), goals: new Set(["g"]) },
      "intermediate",
      5,
      fixed,
    ),
  );
  expect(picked.indexOf("9")).toBe(4);
});

test("a thin bank gives what it has, each once", () => {
  const bank = [q(1, "intermediate", ["a"]), q(2, "advanced", ["a"])];
  const picked = pickRounds(
    bank,
    { shared: new Set(["a"]), goals: new Set(["a"]) },
    "intermediate",
    7,
    fixed,
  );
  expect(ids(picked).sort()).toEqual(["1", "2"]);
});

test("ties are broken by the given random, so the same random gives the same set", () => {
  const bank = Array.from({ length: 20 }, (_, i) =>
    q(i, "intermediate", ["x"]),
  );
  const tiers = { shared: new Set<string>(), goals: new Set<string>() };
  let seed = 1;
  const seeded = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const first = ids(pickRounds(bank, tiers, "intermediate", 7, seeded));
  seed = 1;
  expect(ids(pickRounds(bank, tiers, "intermediate", 7, seeded))).toEqual(
    first,
  );
  expect(first).not.toEqual(["0", "1", "2", "3", "4", "5", "6"]);
});

test("a question without a level counts one step off; one without concepts is general", () => {
  const bank = [q(1, "advanced", []), { ...q(2, "beginner", []), level: null }];
  const tiers = { shared: new Set<string>(), goals: new Set<string>() };
  // Beginner: the unlevelled one (one step) before the advanced one (two).
  expect(ids(pickRounds(bank, tiers, "beginner", 2, fixed))).toEqual([
    "2",
    "1",
  ]);
});
