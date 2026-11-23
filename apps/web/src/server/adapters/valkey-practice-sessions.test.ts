import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import { afterAll, expect, test } from "vitest";
import type { PracticeSessions } from "../ports";
import {
  memoryPracticeSessions,
  valkeyPracticeSessions,
} from "./valkey-practice-sessions";

// ADR-0048: a player's open practice session, one at a time, kept for the session's hour.
const url = process.env["VALKEY_URL"];
if (url === undefined) throw new Error("VALKEY_URL is not set");
const redis = new Redis(url);

afterAll(() => {
  redis.disconnect();
});

async function contract(sessions: PracticeSessions): Promise<void> {
  expect(await sessions.get("u1")).toBeNull();
  await sessions.set("u1", { slug: "lru-cache", matchId: "m1" });
  await sessions.set("u1", { slug: "parking-lot", matchId: "m2" });
  expect(await sessions.get("u1")).toEqual({
    slug: "parking-lot",
    matchId: "m2",
  });
  expect(await sessions.get("u2")).toBeNull();
}

test("the fake keeps the contract", async () => {
  await contract(memoryPracticeSessions());
});

test("Valkey keeps the contract for an hour, and ignores what it didn't write", async () => {
  const prefix = `test-practice-${randomUUID()}:`;
  try {
    const sessions = valkeyPracticeSessions(redis, prefix);
    await contract(sessions);
    const ttl = await redis.ttl(`${prefix}u1`);
    expect(ttl).toBeGreaterThan(3500);
    expect(ttl).toBeLessThanOrEqual(3600);
    await redis.set(`${prefix}u3`, JSON.stringify({ slug: 1 }));
    expect(await sessions.get("u3")).toBeNull();
    await redis.set(`${prefix}u4`, "{not json");
    expect(await sessions.get("u4")).toBeNull();
  } finally {
    const keys = await redis.keys(`${prefix}*`);
    if (keys.length > 0) await redis.del(...keys);
  }
});
