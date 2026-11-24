import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { memorySoloLocks } from "../../../../server/adapters/valkey-solo-locks";
import type {
  Actor,
  HldMatch,
  HldSeat,
  SoloLocks,
} from "../../../../server/ports";

// P6-W42 (MATCH-7; Q-P6-06): one HLD solo at a time, bound to its match so it frees when
// that match ends rather than after the solo's 30 minutes.
const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
const can = vi.fn(() => Promise.resolve(true));
let locks: SoloLocks = memorySoloLocks();
const matches = new Map<string, { match: HldMatch; seats: HldSeat[] }>();
const get = vi.fn((id: string) => Promise.resolve(matches.get(id) ?? null));
const startHldMatch = vi.fn<() => Promise<string>>();
vi.mock("../../../../server/container", () => ({
  sessionReader: () => ({ current }),
  entitlements: () => ({ can }),
  soloLocks: () => locks,
  hldMatches: () => ({ get }),
  hldDeps: () => ({}),
}));
vi.mock("../../../../server/hld-matches", () => ({
  startHldMatch: () => startHldMatch(),
}));
vi.mock("../../../../env", () => ({
  env: () => ({ BETTER_AUTH_URL: "http://localhost:3100" }),
}));

const ada: Actor = { userId: "u1", isGuest: false, betaGroup: "student" };
beforeEach(() => {
  locks = memorySoloLocks();
  matches.clear();
  current.mockResolvedValue(ada);
});
afterEach(() => {
  vi.clearAllMocks();
});

const post = async () => {
  const { POST } = await import("./route");
  return POST(
    new Request("http://localhost:3100/api/hld/solo", {
      method: "POST",
      headers: { origin: "http://localhost:3100" },
    }),
  );
};

const a_match = (id: string, ended: Partial<HldMatch> = {}) => {
  const at = new Date("2026-11-23T12:00:00Z");
  matches.set(id, {
    match: {
      id,
      family: "url-shortener",
      battleMode: "human",
      seed: 1,
      spec: "1.0",
      unrated: true,
      windowAt: null,
      startedAt: at,
      deadlineAt: at,
      closedAt: null,
      scoredAt: null,
      rubricIncluded: null,
      ratedAt: null,
      ...ended,
    },
    seats: [],
  });
};

test("a second solo while the first is on is refused, naming the first", async () => {
  startHldMatch.mockResolvedValueOnce("m1");
  a_match("m1");
  const first = await post();
  expect(first.status).toBe(201);
  expect(await first.json()).toEqual({ matchId: "m1" });
  const second = await post();
  expect(second.status).toBe(429);
  expect(await second.json()).toEqual({ matchId: "m1" });
  expect(startHldMatch).toHaveBeenCalledTimes(1);
});

test("a solo whose match closed, was scored or is gone frees the claim", async () => {
  for (const ended of [
    { closedAt: new Date() },
    { scoredAt: new Date() },
    null,
  ]) {
    locks = memorySoloLocks();
    matches.clear();
    startHldMatch.mockResolvedValueOnce("m1").mockResolvedValueOnce("m2");
    expect((await post()).status).toBe(201);
    if (ended !== null) a_match("m1", ended);
    const next = await post();
    expect(next.status).toBe(201);
    expect(await next.json()).toEqual({ matchId: "m2" });
  }
});

test("no session or another site: refused", async () => {
  current.mockResolvedValue(null);
  expect((await post()).status).toBe(401);
  const { POST } = await import("./route");
  const foreign = await POST(
    new Request("http://localhost:3100/api/hld/solo", {
      method: "POST",
      headers: { origin: "https://elsewhere.example" },
    }),
  );
  expect(foreign.status).toBe(403);
});
