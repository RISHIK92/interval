import { expect, test } from "vitest";
import { FINGER, type FingerState } from "./finger-state";

// P3-W16-S05 (Q-P3-24): what the fastest finger screen shows, from the game server's
// messages (services/game/match.go).
const NOW = 1_000_000;
const run = (messages: unknown[]): FingerState =>
  messages.reduce<FingerState>((state, raw) => {
    const next = FINGER.step(state, raw, NOW);
    if (next === null) throw new Error(`refused: ${JSON.stringify(raw)}`);
    return next;
  }, FINGER.start);

const round = (n: number) => ({
  type: "round",
  n,
  stem: `Q${String(n)}?`,
  options: ["a", "b", "c", "d"],
  seconds: 15,
});

test("a countdown, then a round with nobody locked in", () => {
  expect(
    run([
      { type: "joined", match: "m", you: "ada" },
      { type: "countdown", seconds: 3 },
    ]),
  ).toMatchObject({ phase: "countdown", endsAt: NOW + 3000 });
  expect(run([{ type: "joined", match: "m", you: "ada" }, round(1)])).toEqual({
    phase: "round",
    you: "ada",
    totals: {},
    n: 1,
    stem: "Q1?",
    options: ["a", "b", "c", "d"],
    endsAt: NOW + 15_000,
    locked: { n: 1, players: [] },
  });
});

test("who has locked in, never whether they were right", () => {
  const state = run([
    { type: "joined", match: "m", you: "ada" },
    round(1),
    { type: "locked", player: "bob" },
    { type: "locked", player: "ada" },
  ]);
  expect(state).toMatchObject({ locked: { n: 1, players: ["bob", "ada"] } });
});

test("the reveal: the right answer, who took it, the rounds taken so far", () => {
  const state = run([
    { type: "joined", match: "m", you: "ada" },
    round(2),
    {
      type: "reveal",
      n: 2,
      stem: "Q2?",
      options: ["a", "b", "c", "d"],
      correct: 3,
      taken: "bob",
      totals: { ada: 1, bob: 1 },
    },
  ]);
  expect(state).toEqual({
    phase: "reveal",
    you: "ada",
    totals: { ada: 1, bob: 1 },
    n: 2,
    stem: "Q2?",
    options: ["a", "b", "c", "d"],
    correct: 3,
    taken: "bob",
  });
  // The next round starts with nobody locked in, and keeps the totals.
  expect(FINGER.step(state, round(3), NOW)).toMatchObject({
    phase: "round",
    n: 3,
    totals: { ada: 1, bob: 1 },
    locked: { n: 3, players: [] },
  });
});

test("a rejoin mid-round that had answered stays locked in", () => {
  expect(
    run([
      { type: "joined", match: "m", you: "bob" },
      {
        type: "resume",
        n: 4,
        totals: { ada: 2, bob: 1 },
        answered: true,
        locked: ["bob"],
      },
      round(4),
    ]),
  ).toMatchObject({
    phase: "round",
    n: 4,
    totals: { ada: 2, bob: 1 },
    locked: { n: 4, players: ["bob"] },
  });
});

test("a rejoin between rounds waits, then is shown the reveal it missed", () => {
  const back = run([
    { type: "joined", match: "m", you: "bob" },
    { type: "resume", n: 2, totals: { ada: 1, bob: 1 } },
  ]);
  expect(back).toMatchObject({ phase: "waiting" });
  expect(
    FINGER.step(
      back,
      {
        type: "reveal",
        n: 2,
        stem: "Q2?",
        options: ["a", "b"],
        correct: 0,
        taken: "ada",
        totals: { ada: 2, bob: 1 },
      },
      NOW,
    ),
  ).toMatchObject({ phase: "reveal", stem: "Q2?", totals: { ada: 2, bob: 1 } });
});

test("the final: won, lost or a draw, rounds taken and who left", () => {
  const final = (winner: string, abandoned?: string[]) =>
    run([
      { type: "joined", match: "m", you: "ada" },
      { type: "final", totals: { ada: 4, bob: 2 }, winner, abandoned },
    ]);
  expect(final("ada")).toEqual({
    phase: "final",
    you: "ada",
    outcome: "won",
    totals: { ada: 4, bob: 2 },
    abandoned: [],
  });
  expect(final("bob", ["ada"])).toMatchObject({
    outcome: "lost",
    abandoned: ["ada"],
  });
  expect(final("")).toMatchObject({ outcome: "draw" });
  expect(FINGER.over(final(""))).toBe(true);
  expect(run([{ type: "cancelled" }])).toEqual({ phase: "cancelled" });
});

test("what isn't one of its messages is refused", () => {
  expect(FINGER.step(FINGER.start, { type: "question", n: 1 }, NOW)).toBeNull();
  expect(FINGER.step(FINGER.start, { type: "round", n: "1" }, NOW)).toBeNull();
});
