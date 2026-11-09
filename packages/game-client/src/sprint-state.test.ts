import { expect, test } from "vitest";
import {
  parseMessage,
  START,
  sprintStep,
  type SprintState,
} from "./sprint-state";

// P3-W16-S04 (Q-P3-23): what the live sprint screen shows, from the game server's
// messages (services/game/sprint.go).
const NOW = 1_000_000;
const run = (messages: unknown[], from: SprintState = START): SprintState =>
  messages.reduce<SprintState>((state, raw) => {
    const message = parseMessage(raw);
    if (message === null) throw new Error(`refused: ${JSON.stringify(raw)}`);
    return sprintStep(state, message, NOW);
  }, from);

const question = (n: number) => ({
  type: "question",
  n,
  stem: `Q${String(n)}?`,
  options: ["a", "b", "c", "d"],
});

test("joined, then a countdown on the server's seconds", () => {
  expect(
    run([
      { type: "joined", match: "m", you: "ada" },
      { type: "countdown", seconds: 3 },
    ]),
  ).toEqual({ phase: "countdown", you: "ada", endsAt: NOW + 3000 });
});

test("the start, a question, a judgement and both scores", () => {
  const state = run([
    { type: "joined", match: "m", you: "ada" },
    { type: "countdown", seconds: 3 },
    { type: "start", seconds: 60 },
    question(1),
    { type: "judged", n: 1, correct: true },
    { type: "score", correct: { ada: 1, bob: 0 } },
    question(2),
  ]);
  expect(state).toEqual({
    phase: "playing",
    you: "ada",
    endsAt: NOW + 60_000,
    question: { n: 2, stem: "Q2?", options: ["a", "b", "c", "d"], ai: false },
    last: { n: 1, correct: true },
    scores: { ada: 1, bob: 0 },
  });
});

test("every question answered: done, waiting for the clock", () => {
  const state = run([
    { type: "joined", match: "m", you: "ada" },
    { type: "start", seconds: 60 },
    question(30),
    { type: "done" },
  ]);
  expect(state).toMatchObject({ phase: "playing", question: null });
});

test("a resume puts a rejoiner back where it stands", () => {
  expect(
    run([
      { type: "joined", match: "m", you: "bob" },
      { type: "resume", seconds: 41, correct: { ada: 3, bob: 2 } },
      question(5),
    ]),
  ).toEqual({
    phase: "playing",
    you: "bob",
    endsAt: NOW + 41_000,
    question: { n: 5, stem: "Q5?", options: ["a", "b", "c", "d"], ai: false },
    last: null,
    scores: { ada: 3, bob: 2 },
  });
});

test("the final: the outcome, both counts and the review with keys", () => {
  const state = run([
    { type: "joined", match: "m", you: "ada" },
    { type: "start", seconds: 60 },
    {
      type: "final",
      totals: { ada: 1, bob: 2 },
      winner: "bob",
      review: {
        questions: [
          { n: 1, stem: "Q1?", options: ["a", "b"], correct: 1 },
          { n: 2, stem: "Q2?", options: ["a", "b"], correct: 0 },
        ],
        answers: {
          ada: [
            { round: 1, question_id: 9, choice: 1, correct: true, ms: 900 },
          ],
          bob: [],
        },
      },
    },
  ]);
  expect(state).toEqual({
    phase: "final",
    you: "ada",
    outcome: "lost",
    totals: { ada: 1, bob: 2 },
    abandoned: [],
    questions: [
      {
        n: 1,
        stem: "Q1?",
        options: ["a", "b"],
        ai: false,
        correct: 1,
        chosen: 1,
      },
      {
        n: 2,
        stem: "Q2?",
        options: ["a", "b"],
        ai: false,
        correct: 0,
        chosen: null,
      },
    ],
  });
});

test.each([
  ["ada", "won"],
  ["", "draw"],
] as const)("a final whose winner is %j is %s", (winner, outcome) => {
  const state = run([
    { type: "joined", match: "m", you: "ada" },
    { type: "final", totals: {}, winner },
  ]);
  expect(state).toMatchObject({ phase: "final", outcome, questions: [] });
});

test("an abandon is said, and a cancelled match too", () => {
  expect(
    run([
      { type: "joined", match: "m", you: "ada" },
      { type: "final", totals: {}, winner: "ada", abandoned: ["bob"] },
    ]),
  ).toMatchObject({ outcome: "won", abandoned: ["bob"] });
  expect(run([{ type: "cancelled" }])).toEqual({ phase: "cancelled" });
});

test("what isn't a message is refused", () => {
  expect(parseMessage({ type: "question", n: "1" })).toBeNull();
  expect(parseMessage("hello")).toBeNull();
  // Messages of other modes (fastest finger's rounds) are no part of a sprint.
  expect(parseMessage({ type: "reveal", n: 1 })).toBeNull();
});

// ADR-0037: a model-drafted question says so, while playing and in the review.
test("a question's and a reviewed question's ai flag reach the screen", () => {
  const playing = run([
    { type: "joined", match: "m", you: "ada" },
    { type: "start", seconds: 60 },
    { type: "question", n: 1, stem: "Q1?", options: ["a", "b"], ai: true },
  ]);
  expect(playing).toMatchObject({ question: { n: 1, ai: true } });
  const final = run(
    [
      {
        type: "final",
        totals: { ada: 0 },
        winner: "",
        review: {
          questions: [
            { n: 1, stem: "Q1?", options: ["a", "b"], correct: 1, ai: true },
          ],
          answers: { ada: [] },
        },
      },
    ],
    playing,
  );
  expect(final).toMatchObject({ questions: [{ n: 1, ai: true }] });
});
