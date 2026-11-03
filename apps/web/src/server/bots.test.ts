import { expect, test } from "vitest";
import { type BotQuestion, botAnswers } from "./bots";

// P3-W17-S02 (BOT-2, Q-P3-26; owner, 2026-11-03): a bot answers each question right with
// its real correct rate (too few answers: 80/65/50% by level), wrong with a random
// wrong option, at a time drawn from real live times (else the mode's, else 3–9 s).

// A random that returns the given values in turn.
const seq = (...values: number[]) => {
  let i = 0;
  return () => values[i++ % values.length] ?? 0;
};

const q = (over: Partial<BotQuestion> = {}): BotQuestion => ({
  correct: 2,
  options: 4,
  level: "intermediate",
  answers: 0,
  rightRate: 0,
  times: [],
  ...over,
});

test("a question with 20 answers is right at its own rate, at one of its own times", () => {
  const known = q({
    answers: 20,
    rightRate: 0.3,
    times: [1000, 2000, 3000, 4000, 5000],
  });
  // 0.29 < 0.3: right; then the time pick 0.5 → the third of five.
  expect(botAnswers([known], [], "fastest_finger", seq(0.29, 0.5))).toEqual([
    { n: 1, choice: 2, ms: 3000 },
  ]);
  // 0.31 ≥ 0.3: wrong; the wrong pick 0 → the first wrong option, never the key.
  const [wrong] = botAnswers([known], [], "fastest_finger", seq(0.31, 0, 0));
  expect(wrong?.choice).toBe(0);
});

test.each([
  ["beginner", 0.79, true],
  ["beginner", 0.81, false],
  ["intermediate", 0.64, true],
  ["intermediate", 0.66, false],
  ["advanced", 0.49, true],
  ["advanced", 0.51, false],
  [null, 0.64, true],
  [null, 0.66, false],
] as const)(
  "too few answers: a %s question by its level (%s → right %s)",
  (level, roll, right) => {
    const [a] = botAnswers(
      [q({ level, answers: 19, rightRate: 1 })],
      [],
      "fastest_finger",
      seq(roll, 0, 0),
    );
    expect(a?.choice === 2).toBe(right);
  },
);

test("a wrong answer is any option but the key, spread evenly", () => {
  const picks = [0, 0.34, 0.67].map(
    (r) =>
      botAnswers(
        [q({ level: "advanced" })],
        [],
        "fastest_finger",
        seq(0.9, r, 0),
      )[0]?.choice,
  );
  expect(picks).toEqual([0, 1, 3]);
});

test("times: the question's own, else the mode's, else 3–9 s", () => {
  const few = q({ times: [9999, 9999, 9999, 9999] }); // fewer than 5: not its own
  expect(
    botAnswers([few], [100, 200], "fastest_finger", seq(0, 0.5))[0]?.ms,
  ).toBe(200);
  expect(botAnswers([few], [], "fastest_finger", seq(0, 0))[0]?.ms).toBe(3000);
  expect(botAnswers([few], [], "fastest_finger", seq(0, 0.5))[0]?.ms).toBe(
    6000,
  );
});

test("a sprint's times add up from the start; fastest finger's are per round", () => {
  const two = [q({ times: [] }), q({ times: [] })];
  expect(botAnswers(two, [1000], "sprint", seq(0, 0)).map((a) => a.ms)).toEqual(
    [1000, 2000],
  );
  expect(
    botAnswers(two, [1000], "fastest_finger", seq(0, 0)).map((a) => a.ms),
  ).toEqual([1000, 1000]);
  expect(botAnswers(two, [1000], "sprint", seq(0, 0)).map((a) => a.n)).toEqual([
    1, 2,
  ]);
});
