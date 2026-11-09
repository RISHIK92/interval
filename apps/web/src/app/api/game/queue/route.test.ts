import { afterEach, expect, test, vi } from "vitest";
import type {
  Actor,
  Matchmaking,
  PlayerRatings,
} from "../../../../server/ports";

// P3-W16-S02 (MATCH-3): join, poll and leave the live 1v1 queue; accounts and guests.
const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
const join = vi.fn<Matchmaking["join"]>(() => Promise.resolve());
const poll = vi.fn<Matchmaking["poll"]>(() =>
  Promise.resolve({ status: "waiting", waitedMs: 0 }),
);
const leave = vi.fn<Matchmaking["leave"]>(() => Promise.resolve());
const of = vi.fn<PlayerRatings["of"]>(() => Promise.resolve(1612.4));
const emit = vi.fn();
const queueOf = vi.fn<(mode: string) => void>();
// ADR-0036: the route checks its capability; granted unless a test says not.
const can = vi.fn<(userId: string, capability: string) => Promise<boolean>>(
  () => Promise.resolve(true),
);
vi.mock("../../../../server/container", () => ({
  entitlements: () => ({ can }),
  sessionReader: () => ({ current }),
  matchmaking: (mode: string) => {
    queueOf(mode);
    return { join, poll, leave };
  },
  playerRatings: () => ({ of }),
  events: () => ({ emit }),
}));
vi.mock("../../../../env", () => ({
  env: () => ({
    BETTER_AUTH_URL: "http://localhost:3100",
    NODE_ENV: "production",
  }),
}));
vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) =>
        name === "iv_visit" ? { name, value: "visit-1.1790000000" } : undefined,
    }),
}));

const guest: Actor = { userId: "g1", isGuest: true, betaGroup: "student" };

afterEach(() => {
  vi.clearAllMocks();
});

const call = async (
  method: "POST" | "PUT" | "DELETE",
  origin = "http://localhost:3100",
  mode: string | null = "sprint",
) => {
  const route = await import("./route");
  // As a browser sends a non-GET fetch: with its Origin.
  const query = mode === null ? "" : `?mode=${mode}`;
  return route[method](
    new Request(`http://localhost:3100/api/game/queue${query}`, {
      method,
      headers: { origin },
    }),
  );
};

// P3-W16-S04 (Q-P3-23): each mode has its own queue.
test.each(["POST", "PUT", "DELETE"] as const)(
  "%s needs a known mode, and uses that mode's queue",
  async (method) => {
    current.mockResolvedValue(guest);
    expect((await call(method, undefined, null)).status).toBe(400);
    expect((await call(method, undefined, "chess")).status).toBe(400);
    expect(queueOf).not.toHaveBeenCalled();
    await call(method, undefined, "fastest_finger");
    expect(queueOf).toHaveBeenLastCalledWith("fastest_finger");
  },
);

// Q-P3-24: one queue at a time; joining one mode's leaves the other's.
test("joining one mode's queue leaves the other's first", async () => {
  current.mockResolvedValue(guest);
  await call("POST", undefined, "sprint");
  expect(queueOf.mock.calls).toEqual([["fastest_finger"], ["sprint"]]);
  expect(leave).toHaveBeenCalledExactlyOnceWith("g1");
  expect(leave.mock.invocationCallOrder[0]).toBeLessThan(
    join.mock.invocationCallOrder[0] ?? 0,
  );
});

test("a player, guest or not, joins at their rating", async () => {
  current.mockResolvedValue(guest);
  expect((await call("POST")).status).toBe(204);
  expect(join).toHaveBeenCalledExactlyOnceWith("g1", 1612.4);
});

test("polling (a PUT: it pairs) says waiting, or the match, timed once", async () => {
  current.mockResolvedValue(guest);
  const waiting = await call("PUT");
  expect(waiting.headers.get("cache-control")).toBe("no-store");
  expect(await waiting.json()).toEqual({ status: "waiting" });
  expect(emit).not.toHaveBeenCalled();
  poll.mockResolvedValueOnce({
    status: "matched",
    matchId: "m-1",
    waitedMs: 3_400,
    first: true,
  });
  expect(await (await call("PUT")).json()).toEqual({
    status: "matched",
    matchId: "m-1",
  });
  expect(emit).toHaveBeenCalledExactlyOnceWith(
    "match_found",
    { wait_ms: 3_400, opponent: "person" },
    expect.objectContaining({ userId: "g1", sessionId: "visit-1" }),
  );
  // Told again (a later poll): no second event.
  poll.mockResolvedValueOnce({
    status: "matched",
    matchId: "m-1",
    waitedMs: 3_400,
    first: false,
  });
  await call("PUT");
  expect(emit).toHaveBeenCalledOnce();
});

test("leaving takes the player out", async () => {
  current.mockResolvedValue(guest);
  expect((await call("DELETE")).status).toBe(204);
  expect(leave).toHaveBeenCalledWith("g1");
});

test("signed out, or another site: refused, nothing queued", async () => {
  current.mockResolvedValue(null);
  for (const method of ["POST", "PUT", "DELETE"] as const)
    expect((await call(method)).status).toBe(401);
  current.mockResolvedValue(guest);
  for (const method of ["POST", "PUT", "DELETE"] as const)
    expect((await call(method, "https://evil.example")).status).toBe(403);
  expect(join).not.toHaveBeenCalled();
  expect(poll).not.toHaveBeenCalled();
  expect(leave).not.toHaveBeenCalled();
});

// ADR-0036 (OPS-3): live play is checked where it's served, not only on its page.
test("without play.live, the queue answers 403 and touches nothing", async () => {
  current.mockResolvedValue(guest);
  can.mockResolvedValue(false);
  for (const method of ["POST", "PUT", "DELETE"] as const)
    expect((await call(method)).status).toBe(403);
  expect(join).not.toHaveBeenCalled();
  expect(poll).not.toHaveBeenCalled();
  expect(leave).not.toHaveBeenCalled();
  expect(can).toHaveBeenCalledWith("g1", "play.live");
  can.mockResolvedValue(true);
});

// ADR-0036: a live sprint also needs play.sprint, as its page and challenges require.
test("a live sprint needs play.sprint too", async () => {
  current.mockResolvedValue(guest);
  can.mockImplementation((_user, capability) =>
    Promise.resolve(capability !== "play.sprint"),
  );
  expect((await call("POST", undefined, "sprint")).status).toBe(403);
  expect((await call("POST", undefined, "fastest_finger")).status).toBe(204);
  can.mockImplementation(() => Promise.resolve(true));
});

// P4-W21-S02 (Q-P4-05): the app queues too, with no Origin but its expo-origin, and its
// match_found names its platform.
test("the app queues and its match is told with its platform", async () => {
  current.mockResolvedValue(guest);
  poll.mockResolvedValueOnce({
    status: "matched",
    matchId: "m1",
    waitedMs: 2_000,
    first: true,
  });
  const route = await import("./route");
  const response = await route.PUT(
    new Request("http://localhost:3100/api/game/queue?mode=sprint", {
      method: "PUT",
      headers: { "expo-origin": "interval://", "interval-platform": "ios" },
    }),
  );
  expect(response.status).toBe(200);
  expect(emit).toHaveBeenCalledWith(
    "match_found",
    expect.anything(),
    expect.objectContaining({ source: "ios" }),
  );
});
