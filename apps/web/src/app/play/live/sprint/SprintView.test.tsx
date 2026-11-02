import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { SprintView } from "./SprintView";
import type { SprintState } from "../sprint-state";

// P3-W16-S04 (Q-P3-23): the match and its result on screen; right and wrong say so in
// words, not color alone.
const show = (state: SprintState, answered: number | null = null) =>
  renderToStaticMarkup(
    <SprintView state={state} answered={answered} onAnswer={() => undefined} />,
  ).replace(/<[^>]+>/g, "|");

test("playing: both counts, the last judgement and the question", () => {
  const text = show({
    phase: "playing",
    you: "ada",
    endsAt: Date.now() + 30_000,
    question: { n: 4, stem: "Which cache?", options: ["LRU", "FIFO"] },
    last: { n: 3, correct: false },
    scores: { ada: 2, bob: 3 },
  });
  expect(text).toContain("You 2 · Opponent 3");
  expect(text).toContain("✗ Wrong");
  expect(text).toContain("Which cache?");
  expect(text).toContain("LRU");
});

test("an answered question's options wait for the next", () => {
  const html = renderToStaticMarkup(
    <SprintView
      state={{
        phase: "playing",
        you: "ada",
        endsAt: 0,
        question: { n: 4, stem: "Q?", options: ["a", "b"] },
        last: null,
        scores: {},
      }}
      answered={4}
      onAnswer={() => undefined}
    />,
  );
  expect(html.match(/disabled=""/g)).toHaveLength(2);
});

test("every question answered: waiting for the clock", () => {
  expect(
    show({
      phase: "playing",
      you: "ada",
      endsAt: 0,
      question: null,
      last: { n: 30, correct: true },
      scores: { ada: 30 },
    }),
  ).toContain("Waiting for the clock");
});

test("the result: the outcome, both counts, and each question's right answer and yours", () => {
  const text = show({
    phase: "final",
    you: "ada",
    outcome: "lost",
    totals: { ada: 1, bob: 2 },
    abandoned: [],
    questions: [
      { n: 1, stem: "Q1?", options: ["a", "b"], correct: 0, chosen: 1 },
      { n: 2, stem: "Q2?", options: ["c", "d"], correct: 1, chosen: null },
    ],
  });
  expect(text).toContain("You lost");
  expect(text).toContain("You 1 correct · Opponent 2 correct");
  expect(text).toMatch(/a\|.*✓ Right answer/);
  expect(text).toMatch(/b\|.*✗ Your answer/);
  expect(text).toContain("Not answered");
  const right = show({
    phase: "final",
    you: "ada",
    outcome: "won",
    totals: { ada: 1 },
    abandoned: [],
    questions: [
      { n: 1, stem: "Q1?", options: ["a", "b"], correct: 0, chosen: 0 },
    ],
  });
  expect(right).toMatch(/a\|.*✓ Your answer, right/);
  expect(text).toContain("Your rating updates on Play");
});

test("an opponent who left is said; a cancelled match too", () => {
  expect(
    show({
      phase: "final",
      you: "ada",
      outcome: "won",
      totals: {},
      abandoned: ["bob"],
      questions: [],
    }),
  ).toContain("Your opponent left");
  expect(show({ phase: "cancelled" })).toContain("cancelled");
});
