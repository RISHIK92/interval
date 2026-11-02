import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import { afterAll, expect, test } from "vitest";
import type { LiveMatch } from "../ports";
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
