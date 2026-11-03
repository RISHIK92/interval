import { afterEach, expect, test, vi } from "vitest";
import type { Actor, AgentHook, Challenges } from "../../../server/ports";

// P3-W17-S03 (Q-P3-16): each open tab's heartbeat marks its player online, and hands a
// sender the friend's accepted challenge.
const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
const beat = vi.fn<Challenges["beat"]>(() => Promise.resolve());
const pending = vi.fn<Challenges["pending"]>(() => Promise.resolve(null));
const takeAgentFinished = vi.fn<Challenges["takeAgentFinished"]>(() =>
  Promise.resolve(false),
);
const openedPlace = vi.fn<AgentHook["openedPlace"]>(() => Promise.resolve());
vi.mock("../../../server/container", () => ({
  sessionReader: () => ({ current }),
  challenges: () => ({ beat, pending, takeAgentFinished }),
  agentHook: () => ({ openedPlace }),
}));
vi.mock("../../../env", () => ({
  env: () => ({
    BETTER_AUTH_URL: "http://localhost:3100",
    NODE_ENV: "production",
  }),
}));

const guest: Actor = { userId: "g1", isGuest: true, betaGroup: "student" };

afterEach(() => {
  vi.clearAllMocks();
});

const call = async (origin = "http://localhost:3100", body: unknown = {}) => {
  const { POST } = await import("./route");
  return POST(
    new Request("http://localhost:3100/api/presence", {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
};

test("a beat marks the player online and hands over an accepted challenge", async () => {
  current.mockResolvedValue(guest);
  const quiet = await call();
  expect(await quiet.json()).toEqual({ challenge: null, agentFinished: false });
  expect(quiet.headers.get("cache-control")).toBe("no-store");
  expect(beat).toHaveBeenCalledWith("g1", undefined);
  pending.mockResolvedValueOnce({ matchId: "m-1", mode: "sprint" });
  expect(await (await call()).json()).toEqual({
    challenge: { matchId: "m-1", mode: "sprint" },
    agentFinished: false,
  });
});

test("another site or no session: refused, and nobody is marked", async () => {
  current.mockResolvedValue(guest);
  expect((await call("https://evil.example")).status).toBe(403);
  current.mockResolvedValue(null);
  expect((await call()).status).toBe(401);
  expect(beat).not.toHaveBeenCalled();
});

// P3-W17-S04 (Q-P3-28): the page open is kept (the agent hook's place); arriving at the
// saved place clears it, the page already open doesn't; a finished agent is told once.
test("a beat carries the page; only an arrival clears a saved place", async () => {
  current.mockResolvedValue(guest);
  takeAgentFinished.mockResolvedValueOnce(true);
  const reply = await call(undefined, { page: "/read/42?m=3", arrived: false });
  expect(await reply.json()).toEqual({ challenge: null, agentFinished: true });
  expect(beat).toHaveBeenCalledWith("g1", "/read/42?m=3");
  // The page already open when the agent finished: its place stays.
  expect(openedPlace).not.toHaveBeenCalled();
  await call(undefined, { page: "/read/42?m=3", arrived: true });
  expect(openedPlace).toHaveBeenCalledWith(
    "g1",
    "/read/42?m=3",
    expect.any(Date),
  );
});

test.each([
  "/",
  "https://evil.example/x",
  "//evil.example/x",
  "/\\evil.example",
  "/api/presence",
  "/c/AbCdEfGhIjKlMnOpQrStUv",
  `/${"a".repeat(300)}`,
])("a page that's no place (%s) still beats, without a page", async (page) => {
  current.mockResolvedValue(guest);
  const reply = await call(undefined, { page, arrived: true });
  expect(reply.status).toBe(200);
  expect(beat).toHaveBeenCalledWith("g1", undefined);
  expect(openedPlace).not.toHaveBeenCalled();
});

test("a body with other fields is refused", async () => {
  current.mockResolvedValue(guest);
  expect((await call(undefined, { page: "/read/1", prompt: "x" })).status).toBe(
    400,
  );
});
