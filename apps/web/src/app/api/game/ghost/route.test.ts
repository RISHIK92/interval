import { afterEach, expect, test, vi } from "vitest";
import type { Actor, LiveMatch, Matchmaking } from "../../../../server/ports";

// P3-W17-S01 (Q-P3-25): "Play a ghost now" leaves both queues and starts a ghost match.
const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
const leave = vi.fn<Matchmaking["leave"]>(() => Promise.resolve());
const poll = vi.fn<Matchmaking["poll"]>(() =>
  Promise.resolve({ status: "none" }),
);
const queueOf = vi.fn<(mode: string) => void>();
const ghostMatch =
  vi.fn<(userId: string, mode: string) => Promise<LiveMatch | null>>();
vi.mock("../../../../server/container", () => ({
  sessionReader: () => ({ current }),
  matchmaking: (mode: string) => {
    queueOf(mode);
    return { leave, poll };
  },
  ghostMatch,
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
    new Request(`http://localhost:3100/api/game/ghost${query}`, {
      method: "POST",
      headers: { origin },
    }),
  );
};

test("a player leaves both queues and gets the ghost match", async () => {
  current.mockResolvedValue(guest);
  ghostMatch.mockResolvedValueOnce({
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
  expect(ghostMatch).toHaveBeenCalledExactlyOnceWith("g1", "sprint");
});

test("no run fits: 404; a bad mode, another site or no session: refused", async () => {
  current.mockResolvedValue(guest);
  ghostMatch.mockResolvedValueOnce(null);
  expect((await call()).status).toBe(404);
  expect((await call("chess")).status).toBe(400);
  expect((await call("sprint", "https://evil.example")).status).toBe(403);
  current.mockResolvedValue(null);
  expect((await call()).status).toBe(401);
});

test("paired with a person just before: that match, not a ghost", async () => {
  current.mockResolvedValue(guest);
  poll.mockResolvedValueOnce({
    status: "matched",
    matchId: "human-1",
    waitedMs: 4000,
    first: true,
  });
  expect(await (await call()).json()).toEqual({ matchId: "human-1" });
  expect(ghostMatch).not.toHaveBeenCalled();
});
