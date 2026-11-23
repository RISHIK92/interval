import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import { afterAll, expect, test } from "vitest";
import type { SoloLocks } from "../ports";
import { memorySoloLocks, valkeySoloLocks } from "./valkey-solo-locks";

// P5-W32 (Q-P5-19): one solo game of each kind per player, holding its match once made.
const url = process.env["VALKEY_URL"];
if (url === undefined) throw new Error("VALKEY_URL is not set");
const redis = new Redis(url);

afterAll(() => {
  redis.disconnect();
});

async function contract(locks: SoloLocks): Promise<void> {
  expect(await locks.claim("u1", "battle", 60)).toBe(true);
  expect(await locks.claim("u1", "battle", 60)).toEqual({ matchId: null });
  // Each kind of game, and each player, on its own.
  expect(await locks.claim("u1", "hld", 60)).toBe(true);
  expect(await locks.claim("u2", "battle", 60)).toBe(true);
  await locks.bind("u1", "battle", "m1");
  expect(await locks.claim("u1", "battle", 60)).toEqual({ matchId: "m1" });
  // Another match's release leaves the claim.
  await locks.release("u1", "battle", "m0");
  expect(await locks.claim("u1", "battle", 60)).toEqual({ matchId: "m1" });
  await locks.release("u1", "battle", "m1");
  expect(await locks.claim("u1", "battle", 60)).toBe(true);
}

test("the fake keeps the contract, and a claim lapses", async () => {
  let now = 0;
  const locks = memorySoloLocks(() => now);
  await contract(locks);
  expect(await locks.claim("u3", "battle", 60)).toBe(true);
  now = 61_000;
  expect(await locks.claim("u3", "battle", 60)).toBe(true);
});

test("Valkey keeps the contract, and binding keeps the claim's time", async () => {
  const prefix = `test-solo-${randomUUID()}:`;
  try {
    const locks = valkeySoloLocks(redis, prefix);
    await contract(locks);
    expect(await locks.claim("u4", "battle", 600)).toBe(true);
    await locks.bind("u4", "battle", "m4");
    const ttl = await redis.ttl(`${prefix}battle:solo:u4`);
    expect(ttl).toBeGreaterThan(590);
    expect(ttl).toBeLessThanOrEqual(600);
  } finally {
    const keys = await redis.keys(`${prefix}*`);
    if (keys.length > 0) await redis.del(...keys);
  }
});
