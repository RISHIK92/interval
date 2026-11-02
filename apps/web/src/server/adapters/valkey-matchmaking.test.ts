import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import { afterAll, expect, test } from "vitest";
import type { Matchmaking } from "../ports";
import { memoryMatchmaking, valkeyMatchmaking } from "./valkey-matchmaking";

// P3-W16-S02 (MATCH-3; owner, 2026-11-03): ±100, widening by 100 every 2 s, both ways.
const url = process.env["VALKEY_URL"];
if (url === undefined) throw new Error("VALKEY_URL is not set");
const redis = new Redis(url);

afterAll(() => {
  redis.disconnect();
});

type Clock = { now: () => number; advance: (ms: number) => void };
const clock = (): Clock => {
  let now = 1_800_000_000_000;
  return { now: () => now, advance: (ms) => (now += ms) };
};

// `start` makes a match for a pair (the game server's handoff) and records it; `hold`
// keeps the next one in flight until released, to look at the pending window.
type Starter = {
  start: (players: string[]) => Promise<string>;
  started: string[][];
  failNext: () => void;
  hold: () => () => void;
};
const starter = (): Starter => {
  const started: string[][] = [];
  let fail = false;
  let gate: Promise<void> | undefined;
  return {
    started,
    failNext: () => (fail = true),
    hold: () => {
      let release = () => {};
      gate = new Promise((r) => (release = r));
      return release;
    },
    start: async (players) => {
      if (gate !== undefined) {
        const waiting = gate;
        gate = undefined;
        await waiting;
      }
      if (fail) {
        fail = false;
        throw new Error("no questions");
      }
      started.push([...players].sort());
      return `match-${String(started.length)}`;
    },
  };
};

async function contract(mm: Matchmaking, c: Clock, s: Starter): Promise<void> {
  const id = () => `p-${randomUUID()}`;
  // 150 apart: not at first (±100), but after 2 s (±200) both ways.
  const [a, b] = [id(), id()];
  await mm.join(a, 1500);
  await mm.join(b, 1650);
  expect(await mm.poll(a)).toEqual({ status: "waiting", waitedMs: 0 });
  c.advance(1_000);
  // Joining again (a reload) keeps the wait.
  await mm.join(a, 1500);
  c.advance(1_000);
  const found = await mm.poll(a);
  expect(found).toMatchObject({
    status: "matched",
    waitedMs: 2_000,
    first: true,
  });
  const matchId = found.status === "matched" ? found.matchId : "";
  expect(s.started).toEqual([[a, b].sort()]);
  // Both are told, each once first, and on every poll after (a lost reply recovers).
  expect(await mm.poll(b)).toEqual({
    status: "matched",
    matchId,
    waitedMs: 2_000,
    first: true,
  });
  expect(await mm.poll(b)).toEqual({
    status: "matched",
    matchId,
    waitedMs: 2_000,
    first: false,
  });
  expect(await mm.poll(a)).toMatchObject({
    status: "matched",
    matchId,
    first: false,
  });

  // The closest in the band.
  const [c1, near, far] = [id(), id(), id()];
  await mm.join(far, 1590);
  await mm.join(near, 1560);
  await mm.join(c1, 1500);
  await mm.poll(c1);
  expect(s.started.at(-1)).toEqual([c1, near].sort());
  await mm.leave(far);

  // Both ways: a long waiter's band covers a newcomer whose own band doesn't yet.
  const [old, fresh] = [id(), id()];
  await mm.join(old, 1500);
  c.advance(2_000);
  await mm.join(fresh, 1690);
  expect(await mm.poll(old)).toMatchObject({ status: "waiting" });
  c.advance(2_000);
  // Each side's own wait: the newcomer 2 s, the long waiter 4 s.
  expect(await mm.poll(fresh)).toMatchObject({
    status: "matched",
    waitedMs: 2_000,
  });
  expect(await mm.poll(old)).toMatchObject({
    status: "matched",
    waitedMs: 4_000,
  });

  // Joining again after a match (played, abandoned or cancelled) starts a fresh wait.
  await mm.join(old, 1500);
  expect(await mm.poll(old)).toEqual({ status: "waiting", waitedMs: 0 });
  await mm.leave(old);

  // While the match is being made, the other is waiting, not dropped.
  const [p1, p2] = [id(), id()];
  await mm.join(p1, 1500);
  await mm.join(p2, 1500);
  const release = s.hold();
  const pairing = mm.poll(p1);
  await new Promise((r) => setTimeout(r, 20));
  expect(await mm.poll(p2)).toMatchObject({ status: "waiting" });
  release();
  expect(await pairing).toMatchObject({ status: "matched" });
  expect(await mm.poll(p2)).toMatchObject({ status: "matched", first: true });

  // Leaving while being paired: the other queues again, with its wait.
  const [l1, l2, l3] = [id(), id(), id()];
  await mm.join(l1, 1500);
  c.advance(1_000);
  await mm.join(l2, 1500);
  const releaseL = s.hold();
  const leaving = mm.poll(l1);
  await new Promise((r) => setTimeout(r, 20));
  await mm.leave(l2);
  releaseL();
  expect(await leaving).toEqual({ status: "waiting", waitedMs: 1_000 });
  expect(await mm.poll(l2)).toEqual({ status: "none" });
  await mm.join(l3, 1500);
  expect(await mm.poll(l1)).toMatchObject({ status: "matched" });

  // A pair whose match was never made nor put back (the request died): after 10 s,
  // each is queued again by their own poll.
  const [d1, d2, d3] = [id(), id(), id()];
  await mm.join(d1, 1500);
  await mm.join(d2, 1500);
  s.hold(); // never released
  void mm.poll(d1);
  await new Promise((r) => setTimeout(r, 20));
  expect(await mm.poll(d2)).toMatchObject({ status: "waiting" });
  c.advance(11_000);
  await mm.join(d3, 1500);
  expect(await mm.poll(d2)).toMatchObject({ status: "matched" });
  expect(s.started.at(-1)).toEqual([d2, d3].sort());
  await mm.poll(d3);
  await mm.leave(d1);

  // Left: gone.
  const gone = id();
  await mm.join(gone, 1500);
  await mm.leave(gone);
  expect(await mm.poll(gone)).toEqual({ status: "none" });

  // Making the match failed: both wait on from when they joined, and pair next time.
  const [x, y] = [id(), id()];
  await mm.join(x, 1500);
  await mm.join(y, 1500);
  s.failNext();
  c.advance(1_000);
  expect(await mm.poll(x)).toEqual({ status: "waiting", waitedMs: 1_000 });
  expect(await mm.poll(y)).toMatchObject({
    status: "matched",
    waitedMs: 1_000,
  });

  // A player who stopped polling 30 s ago (a closed tab) is dropped, not matched.
  const [stale, live] = [id(), id()];
  await mm.join(stale, 1500);
  c.advance(31_000);
  await mm.join(live, 1500);
  expect(await mm.poll(live)).toMatchObject({ status: "waiting" });
  expect(await mm.poll(stale)).toEqual({ status: "none" });
  await mm.leave(live);
}

test("the in-memory fake keeps the contract", async () => {
  const c = clock();
  const s = starter();
  await contract(memoryMatchmaking(s.start, c.now), c, s);
});

test("the Valkey adapter keeps the contract", async () => {
  const c = clock();
  const s = starter();
  const prefix = `test-mm-${randomUUID()}:`;
  try {
    await contract(valkeyMatchmaking(redis, s.start, c.now, prefix), c, s);
  } finally {
    const keys = await redis.keys(`${prefix}*`);
    if (keys.length > 0) await redis.del(...keys);
  }
});

test("two players polling at once for the same opponent make one match", async () => {
  const c = clock();
  const s = starter();
  const prefix = `test-mm-${randomUUID()}:`;
  try {
    const mm = valkeyMatchmaking(redis, s.start, c.now, prefix);
    await mm.join("p1", 1500);
    await mm.join("p2", 1500);
    await mm.join("p3", 1500);
    await Promise.all(["p1", "p2", "p3"].map((p) => mm.poll(p)));
    // One pair claimed, atomically: two matched, the third still waiting.
    expect(s.started).toHaveLength(1);
    const states = await Promise.all(["p1", "p2", "p3"].map((p) => mm.poll(p)));
    expect(states.filter((x) => x.status === "matched")).toHaveLength(2);
    expect(states.filter((x) => x.status === "waiting")).toHaveLength(1);
  } finally {
    const keys = await redis.keys(`${prefix}*`);
    if (keys.length > 0) await redis.del(...keys);
  }
});

test("a player whose state vanishes while the match is made isn't matched", async () => {
  const c = clock();
  const s = starter();
  const prefix = `test-mm-${randomUUID()}:`;
  try {
    const mm = valkeyMatchmaking(redis, s.start, c.now, prefix);
    await mm.join("v1", 1500);
    await mm.join("v2", 1500);
    const release = s.hold();
    const pairing = mm.poll("v1");
    await new Promise((r) => setTimeout(r, 20));
    await redis.del(`${prefix}p:v2`); // expired, say
    release();
    expect(await pairing).toMatchObject({ status: "waiting" });
    expect(await mm.poll("v2")).toEqual({ status: "none" });
    // v1 is queued again, not left half-paired.
    expect(await redis.zscore(`${prefix}queue`, "v1")).toBe("1500");
  } finally {
    const keys = await redis.keys(`${prefix}*`);
    if (keys.length > 0) await redis.del(...keys);
  }
});
