import { expect, test } from "vitest";
import {
  BATTLE,
  BATTLE_START,
  type BattleState,
  battleSent,
} from "./battle-state";

// P5-W31-S03 (§6.5; Q-P5-15, Q-P5-16; LLDQ-4): the battle screen's state, message by
// message, as the game server sends them (services/game/battle_actor.go).
function play(...messages: unknown[]): BattleState {
  let state = BATTLE_START;
  let now = 1_000;
  for (const m of messages) {
    const next = BATTLE.step(state, m, now);
    if (next !== null) state = next;
    now += 1_000;
  }
  return state;
}

const start = {
  type: "battle",
  seconds: 2700,
  revealed: false,
  best: { ada: 0, bob: 0 },
};

test("a battle starts on the server's clock, with nothing of the extension", () => {
  const s = play({ type: "joined", you: "ada" }, start);
  expect(s).toMatchObject({
    phase: "playing",
    you: "ada",
    endsAt: 2_000 + 2_700_000,
    extension: null,
  });
});

test("Run and Submit wait for their answers; refusals and judge failures free them", () => {
  let s = battleSent(play(start), false);
  expect(s).toMatchObject({ running: true, submitting: false });
  s =
    BATTLE.step(
      s,
      {
        type: "ran",
        tests: [
          { passed: false, verdict: "ok", call: 3, reason: "wrong value" },
        ],
      },
      0,
    ) ?? s;
  expect(s).toMatchObject({
    running: false,
    ran: [{ passed: false, call: 3, reason: "wrong value" }],
  });
  s = battleSent(s, true);
  s =
    BATTLE.step(
      s,
      { type: "refused", code: "cooldown", reason: "wait 20 s", submit: true },
      0,
    ) ?? s;
  expect(s).toMatchObject({ submitting: false, notice: "wait 20 s" });
  s = battleSent(s, true);
  s = BATTLE.step(s, { type: "judge_error", submit: true }, 0) ?? s;
  expect(s).toMatchObject({ submitting: false });
  expect(s.phase === "playing" ? s.notice : null).toMatch(/try again/);
  s = battleSent(s, true);
  s =
    BATTLE.step(
      s,
      {
        type: "submitted",
        points: 700,
        layers: { hidden: { passed: 2, total: 2 } },
        best: 700,
      },
      0,
    ) ?? s;
  expect(s).toMatchObject({
    submitting: false,
    notice: null,
    submitted: { points: 700, layers: { hidden: { passed: 2, total: 2 } } },
  });
});

test("the extension arrives with the reveal, or with a rejoin after it", () => {
  const ext = {
    type: "extension",
    seconds: 900,
    statement: "# More",
    starters: { python: "def grow" },
  };
  expect(play(start, ext)).toMatchObject({
    extension: { statement: "# More" },
    endsAt: 2_000 + 900_000,
  });
  expect(
    play({ ...start, seconds: 300, revealed: true, extension: ext }),
  ).toMatchObject({
    extension: { starters: { python: "def grow" } },
  });
});

test("others' bests update; the final names the outcome; nothing follows it", () => {
  const s = play(
    { type: "joined", you: "ada" },
    start,
    { type: "best", best: { ada: 700, bob: 1000 } },
    { type: "final", totals: { ada: 700, bob: 1000 }, winner: "bob" },
    { type: "best", best: { ada: 1000, bob: 1000 } },
  );
  expect(s).toEqual({
    phase: "final",
    you: "ada",
    outcome: "lost",
    totals: { ada: 700, bob: 1000 },
    abandoned: [],
  });
  expect(BATTLE.over(s)).toBe(true);
});

test("what isn't a battle message is left alone", () => {
  expect(BATTLE.step(BATTLE_START, { type: "question", n: 1 }, 0)).toBeNull();
  expect(
    BATTLE.step(BATTLE_START, { type: "submitted", points: -1 }, 0),
  ).toBeNull();
});

test("a problem with no extension still reveals, with nothing to show", () => {
  expect(play(start, { type: "extension", seconds: 900 })).toMatchObject({
    phase: "playing",
    endsAt: 2_000 + 900_000,
    extension: null,
  });
  expect(
    play({
      ...start,
      revealed: true,
      extension: { type: "extension", seconds: 300 },
    }),
  ).toMatchObject({ phase: "playing", extension: null });
});

test("a rejoin keeps the last results and frees the buttons; a late joined names you", () => {
  let s = play(start, {
    type: "submitted",
    points: 400,
    layers: { visible: { passed: 1, total: 1 } },
    best: 400,
  });
  s = battleSent(battleSent(s, false), true);
  s = BATTLE.step(s, { type: "joined", you: "bob" }, 0) ?? s;
  s = BATTLE.step(s, { ...start, seconds: 100 }, 0) ?? s;
  expect(s).toMatchObject({
    you: "bob",
    running: false,
    submitting: false,
    submitted: { points: 400 },
  });
});

test("a refused Submit frees only Submit", () => {
  let s = battleSent(battleSent(play(start), false), true);
  s =
    BATTLE.step(
      s,
      { type: "refused", code: "cooldown", reason: "wait", submit: true },
      0,
    ) ?? s;
  expect(s).toMatchObject({ running: true, submitting: false });
});
