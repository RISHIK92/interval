import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Redis } from "ioredis";
import { afterAll, expect, test } from "vitest";
import type { BattleMatch, LiveMatch } from "../ports";
import { valkeyMatchHandoff } from "./valkey-match-handoff";

// P3-W15-S03 (Q-P3-22): the game server reads game:match:<id> (services/game/store.go).
const url = process.env["VALKEY_URL"];
if (url === undefined) throw new Error("VALKEY_URL is not set");
const redis = new Redis(url);

afterAll(() => {
  redis.disconnect();
});

test("puts the match as the game server reads it, for an hour", async () => {
  const match: LiveMatch = {
    id: randomUUID(),
    serverId: 0,
    players: ["ada", "bob"],
    mode: "sprint",
    rounds: [
      {
        question: "41",
        stem: "Which?",
        options: ["a", "b", "c", "d"],
        correct: 2,
        ai: true,
      },
    ],
  };
  const key = `game:match:${match.id}`;
  try {
    await valkeyMatchHandoff(redis).put(match);
    expect(JSON.parse((await redis.get(key)) ?? "null")).toEqual({
      players: ["ada", "bob"],
      mode: "sprint",
      // Go reads the question id as a number (int64).
      rounds: [
        {
          question: 41,
          stem: "Which?",
          options: ["a", "b", "c", "d"],
          correct: 2,
          // ADR-0037: the game server shows a drafted question as such.
          ai: true,
        },
      ],
    });
    const ttl = await redis.ttl(key);
    expect(ttl).toBeGreaterThan(3500);
    expect(ttl).toBeLessThanOrEqual(3600);
  } finally {
    await redis.del(key);
  }
});

// P3-W17-S01: a ghost match hands over its ghost (services/game ghostDef).
test("a ghost match hands over the ghost's seat, label and answers", async () => {
  const ghost = {
    player: "ghost:7",
    label: "Ghost · ~1600",
    answers: [{ n: 1, choice: 2, ms: 3100 }],
  };
  const match: LiveMatch = {
    id: randomUUID(),
    serverId: 0,
    players: ["ada", "ghost:7"],
    mode: "fastest_finger",
    rounds: [
      {
        question: "41",
        stem: "Which?",
        options: ["a", "b", "c", "d"],
        correct: 2,
        ai: true,
      },
    ],
    ghost,
  };
  const key = `game:match:${match.id}`;
  try {
    await valkeyMatchHandoff(redis).put(match);
    expect(JSON.parse((await redis.get(key)) ?? "null")).toMatchObject({
      players: ["ada", "ghost:7"],
      ghost,
    });
  } finally {
    await redis.del(key);
  }
});

// P5-W31-S02b: a battle as the game server reads it. Both sides test against
// services/game/testdata/battle.json, which battle_test.go parses.
test("puts a battle as the game server reads it", async () => {
  const wire = JSON.parse(
    readFileSync(
      join(
        import.meta.dirname,
        "../../../../../services/game/testdata/battle.json",
      ),
      "utf8",
    ),
  ) as { players: string[]; battle: BattleMatch["battle"] };
  const match: BattleMatch = {
    id: randomUUID(),
    players: wire.players,
    battle: wire.battle,
  };
  const key = `game:match:${match.id}`;
  try {
    await valkeyMatchHandoff(redis).putBattle(match);
    expect(JSON.parse((await redis.get(key)) ?? "null")).toEqual(wire);
    expect(await redis.ttl(key)).toBeGreaterThan(3500);
  } finally {
    await redis.del(key);
  }
});
