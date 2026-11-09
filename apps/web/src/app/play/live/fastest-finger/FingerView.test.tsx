import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import type { FingerState } from "@interval/game-client";
import { FingerView } from "./FingerView";

// P3-W16-S05 (Q-P3-24): rounds, reveals and the result on screen; locked answers and
// the opponent's status say so in words.
const show = (state: FingerState, answered: number | null = null) =>
  renderToStaticMarkup(
    <FingerView state={state} answered={answered} onAnswer={() => undefined} />,
  );
const words = (html: string) => html.replace(/<[^>]+>/g, "|");

const round = (players: string[]): FingerState => ({
  phase: "round",
  you: "ada",
  totals: { ada: 2, bob: 1 },
  n: 4,
  stem: "Which cache?",
  options: ["LRU", "FIFO"],
  ai: true,
  endsAt: 0,
  locked: { n: 4, players },
});

test("a round: the score, the question, and who has locked in", () => {
  const open = words(show(round([])));
  expect(open).toContain("Rounds: you 2 · opponent 1");
  expect(open).toContain("Which cache?");
  // ADR-0037: a model-drafted question says so.
  expect(open).toContain("AI-drafted");
  expect(open).toContain("⏳ Opponent: thinking");
  expect(open).toContain("You: choose an answer");
  const theirs = words(show(round(["bob"])));
  expect(theirs).toContain("🔒 Opponent: locked in");
});

test("locked in, by the server or just now, the options wait", () => {
  for (const html of [show(round(["ada"])), show(round([]), 4)]) {
    expect(words(html)).toContain("🔒 You: locked in");
    expect(html.match(/disabled=""/g)).toHaveLength(2);
  }
});

test.each([
  ["ada", "✓ You took this round"],
  ["bob", "✗ Your opponent took this round"],
  ["", "Nobody took this round"],
])("a reveal taken by %j says so, with the right answer", (taken, line) => {
  const text = words(
    show({
      phase: "reveal",
      you: "ada",
      totals: {},
      n: 1,
      stem: "Q?",
      options: ["a", "b"],
      ai: false,
      correct: 1,
      taken,
    }),
  );
  expect(text).toContain(line);
  expect(text).toMatch(/b\|.*✓ Right answer/);
});

test("the result: the outcome and rounds taken; a leaver is said", () => {
  const text = words(
    show({
      phase: "final",
      you: "ada",
      outcome: "won",
      totals: { ada: 4, bob: 2 },
      abandoned: ["bob"],
    }),
  );
  expect(text).toContain("You won");
  expect(text).toContain("Rounds taken: you 4 · opponent 2");
  expect(text).toContain("Your opponent left");
});
