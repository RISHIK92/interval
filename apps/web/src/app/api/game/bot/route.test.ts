import { afterEach, expect, test, vi } from "vitest";
import type { Actor, LiveMatch, Matchmaking } from "../../../../server/ports";

// P3-W17-S01, S02 (C-01): "Play bot now" leaves both queues and starts a ghost or bot.
const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
const leave = vi.fn<Matchmaking["leave"]>(() => Promise.resolve());
const poll = vi.fn<Matchmaking["poll"]>(() =>
  Promise.resolve({ status: "none" }),
);
const queueOf = vi.fn<(mode: string) => void>();
const replayMatch =
  vi.fn<(userId: string, mode: string) => Promise<LiveMatch | null>>();
const emit = vi.fn();
vi.mock("../../../../server/container", () => ({
  events: () => ({ emit }),
  sessionReader: () => ({ current }),
  matchmaking: (mode: string) => {
    queueOf(mode);
    return { leave, poll };
  },
  replayMatch,
}));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => ({ value: "visit-1" }) }),
}));
vi.mock("../../../../env", () => ({
  env: () => ({
    BETTER_AUTH_URL: "http://localhost:3100",
    NODE_ENV: "production",
  }),
}));

const guest: Actor = { userId: "g1", isGuest: true, betaGroup: "student" };

afterEach(() => {
  vi.clearAllMocks();
});

const call = async (
  mode: string | null = "sprint",
  origin = "http://localhost:3100",
) => {
  const { POST } = await import("./route");
  const query = mode === null ? "" : `?mode=${mode}`;
  return POST(
    new Request(`http://localhost:3100/api/game/bot${query}`, {
      method: "POST",
      headers: { origin },
    }),
  );
};

test("a player leaves both queues and gets the ghost or bot match", async () => {
  current.mockResolvedValue(guest);
  replayMatch.mockResolvedValueOnce({
    id: "m-9",
    serverId: 0,
    players: ["g1", "ghost:3"],
    mode: "sprint",
    rounds: [],
  });
  const response = await call();
  expect(await response.json()).toEqual({ matchId: "m-9" });
  expect([...new Set(queueOf.mock.calls.flat())].sort()).toEqual([
    "fastest_finger",
    "sprint",
  ]);
  expect(leave).toHaveBeenCalledTimes(2);
  expect(replayMatch).toHaveBeenCalledExactlyOnceWith("g1", "sprint");
});

test("not even a bot: 404; a bad mode, another site or no session: refused", async () => {
  current.mockResolvedValue(guest);
  replayMatch.mockResolvedValueOnce(null);
  expect((await call()).status).toBe(404);
  expect((await call("chess")).status).toBe(400);
  expect((await call("sprint", "https://evil.example")).status).toBe(403);
  current.mockResolvedValue(null);
  expect((await call()).status).toBe(401);
});

test("paired with a person just before: that match, not a ghost or bot", async () => {
  current.mockResolvedValue(guest);
  poll.mockResolvedValueOnce({
    status: "matched",
    matchId: "human-1",
    waitedMs: 4000,
    first: true,
  });
  expect(await (await call()).json()).toEqual({ matchId: "human-1" });
  expect(replayMatch).not.toHaveBeenCalled();
});

// P3-W18-S03 (owner, 2026-11-05): every live match counts toward the time-to-match
// metric: the wait is the queue's, from a poll before leaving it.
test("a ghost or bot match is found after the queue's wait", async () => {
  current.mockResolvedValue(guest);
  poll.mockResolvedValueOnce({ status: "waiting", waitedMs: 10_200 });
  replayMatch.mockResolvedValueOnce({
    id: "m-9",
    serverId: 0,
    players: ["g1", "bot"],
    mode: "sprint",
    rounds: [],
    ghost: { player: "bot", label: "Bot · ~1500", answers: [] },
  });
  await call();
  expect(emit).toHaveBeenCalledExactlyOnceWith(
    "match_found",
    { wait_ms: 10_200, opponent: "bot" },
    expect.objectContaining({ userId: "g1" }),
  );
  emit.mockClear();
  poll.mockResolvedValueOnce({ status: "waiting", waitedMs: 3_000 });
  replayMatch.mockResolvedValueOnce({
    id: "m-10",
    serverId: 0,
    players: ["g1", "ghost:4"],
    mode: "sprint",
    rounds: [],
    ghost: { player: "ghost:4", label: "Ghost · ~1500", answers: [] },
  });
  await call();
  expect(emit).toHaveBeenCalledExactlyOnceWith(
    "match_found",
    { wait_ms: 3_000, opponent: "ghost" },
    expect.objectContaining({ userId: "g1" }),
  );
});

test("a person found by that poll is the match, told once", async () => {
  current.mockResolvedValue(guest);
  poll.mockResolvedValueOnce({
    status: "matched",
    matchId: "human-2",
    waitedMs: 7_000,
    first: true,
  });
  expect(await (await call()).json()).toEqual({ matchId: "human-2" });
  expect(emit).toHaveBeenCalledExactlyOnceWith(
    "match_found",
    { wait_ms: 7_000, opponent: "person" },
    expect.objectContaining({ userId: "g1" }),
  );
  expect(replayMatch).not.toHaveBeenCalled();
  expect(leave).not.toHaveBeenCalled();
});

test("nothing made, or no wait known (out of the queue), nothing told", async () => {
  current.mockResolvedValue(guest);
  replayMatch.mockResolvedValueOnce(null);
  await call();
  replayMatch.mockResolvedValueOnce({
    id: "m-11",
    serverId: 0,
    players: ["g1", "bot"],
    mode: "sprint",
    rounds: [],
    ghost: { player: "bot", label: "Bot · ~1500", answers: [] },
  });
  await call(); // the poll says none
  expect(emit).not.toHaveBeenCalled();
});
