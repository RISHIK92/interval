import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import { afterAll, expect, test } from "vitest";
import type { RateLimits } from "../ports";
import { memoryRateLimits, valkeyRateLimits } from "./valkey-rate-limits";

// A fixed window per key: past the limit, refused until the window ends.
const url = process.env["VALKEY_URL"];
if (url === undefined) throw new Error("VALKEY_URL is not set");
const redis = new Redis(url);

afterAll(() => {
  redis.disconnect();
});

async function contract(limits: RateLimits, key: string): Promise<void> {
  for (let i = 0; i < 3; i += 1)
    expect(await limits.allow(key, 3, 60)).toBe(true);
  expect(await limits.allow(key, 3, 60)).toBe(false);
  expect(await limits.allow(`${key}-other`, 3, 60)).toBe(true);
}

test("the fake keeps the contract, and its window ends", async () => {
  let now = 0;
  const limits = memoryRateLimits(() => now);
  await contract(limits, "d1");
  now += 60_000;
  expect(await limits.allow("d1", 3, 60)).toBe(true);
});

test("Valkey keeps the contract, the window set once", async () => {
  const prefix = `test-limit-${randomUUID()}:`;
  try {
    await contract(valkeyRateLimits(redis, prefix), "d1");
    const ttl = await redis.ttl(`${prefix}d1`);
    expect(ttl).toBeGreaterThan(55);
    expect(ttl).toBeLessThanOrEqual(60);
  } finally {
    const keys = await redis.keys(`${prefix}*`);
    if (keys.length > 0) await redis.del(...keys);
  }
});
