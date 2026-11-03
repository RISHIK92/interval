import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import { afterAll, expect, test } from "vitest";
import type { Challenges } from "../ports";
import { memoryChallenges, valkeyChallenges } from "./valkey-challenges";

// P3-W17-S03 (Q-P3-16): a link admits one friend, never its sender; presence and the
// accepted notice expire.
const url = process.env["VALKEY_URL"];
if (url === undefined) throw new Error("VALKEY_URL is not set");
const redis = new Redis(url);

afterAll(() => {
  redis.disconnect();
});

async function contract(c: Challenges): Promise<void> {
  const token = await c.create("ada", "sprint");
  expect(await c.peek(token, "ada")).toEqual({ status: "own" });
  expect(await c.take(token, "ada")).toEqual({ status: "own" });
  expect(await c.peek(token, "bob")).toEqual({
    status: "open",
    sender: "ada",
    mode: "sprint",
  });
  // Peeking takes nothing: still open.
  expect(await c.take(token, "bob")).toEqual({
    status: "open",
    sender: "ada",
    mode: "sprint",
  });
  expect(await c.take(token, "cat")).toEqual({ status: "taken" });
  expect(await c.peek(token, "bob")).toEqual({ status: "taken" });
  expect(await c.peek("no-such-token", "bob")).toEqual({ status: "expired" });

  expect(await c.online("ada")).toBe(false);
  await c.beat("ada");
  expect(await c.online("ada")).toBe(true);

  expect(await c.pending("ada")).toBeNull();
  await c.notify("ada", { matchId: "m1", mode: "sprint" });
  expect(await c.pending("ada")).toEqual({ matchId: "m1", mode: "sprint" });
}

test("the in-memory fake keeps the contract, and its expiries", async () => {
  let now = 0;
  const c = memoryChallenges(() => now);
  await contract(c);
  const token = await c.create("ada", "fastest_finger");
  now += 599_000;
  expect((await c.peek(token, "bob")).status).toBe("open");
  now += 1_000; // 10 minutes
  expect(await c.take(token, "bob")).toEqual({ status: "expired" });
  // Online for 2 minutes after a beat; the notice for 1.
  await c.beat("bob");
  await c.notify("bob", { matchId: "m2", mode: "sprint" });
  now += 60_000;
  expect(await c.pending("bob")).toBeNull();
  expect(await c.online("bob")).toBe(true);
  now += 60_000;
  expect(await c.online("bob")).toBe(false);
});

test("the Valkey adapter keeps the contract, with the same expiries", async () => {
  const prefix = `test-ch-${randomUUID()}:`;
  try {
    const c = valkeyChallenges(redis, prefix);
    await contract(c);
    const token = await c.create("ada", "sprint");
    const ttl = async (key: string) => redis.ttl(`${prefix}${key}`);
    expect(await ttl(`challenge:${token}`)).toBeGreaterThan(595);
    expect(await ttl("presence:ada")).toBeGreaterThan(115);
    expect(await ttl("presence:ada")).toBeLessThanOrEqual(120);
    expect(await ttl("challenge-for:ada")).toBeLessThanOrEqual(60);
  } finally {
    const keys = await redis.keys(`${prefix}*`);
    if (keys.length > 0) await redis.del(...keys);
  }
});

test("of two opening at once, one takes it", async () => {
  const prefix = `test-ch-${randomUUID()}:`;
  try {
    const c = valkeyChallenges(redis, prefix);
    const token = await c.create("ada", "sprint");
    const results = await Promise.all(
      ["b1", "b2", "b3", "b4"].map((who) => c.take(token, who)),
    );
    expect(results.filter((r) => r.status === "open")).toHaveLength(1);
    expect(results.filter((r) => r.status === "taken")).toHaveLength(3);
  } finally {
    const keys = await redis.keys(`${prefix}*`);
    if (keys.length > 0) await redis.del(...keys);
  }
});
