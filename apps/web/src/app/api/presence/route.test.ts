import { afterEach, expect, test, vi } from "vitest";
import type { Actor, Challenges } from "../../../server/ports";

// P3-W17-S03 (Q-P3-16): each open tab's heartbeat marks its player online, and hands a
// sender the friend's accepted challenge.
const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
const beat = vi.fn<Challenges["beat"]>(() => Promise.resolve());
const pending = vi.fn<Challenges["pending"]>(() => Promise.resolve(null));
vi.mock("../../../server/container", () => ({
  sessionReader: () => ({ current }),
  challenges: () => ({ beat, pending }),
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

const call = async (origin = "http://localhost:3100") => {
  const { POST } = await import("./route");
  return POST(
    new Request("http://localhost:3100/api/presence", {
      method: "POST",
      headers: { origin },
    }),
  );
};

test("a beat marks the player online and hands over an accepted challenge", async () => {
  current.mockResolvedValue(guest);
  const quiet = await call();
  expect(await quiet.json()).toEqual({ challenge: null });
  expect(quiet.headers.get("cache-control")).toBe("no-store");
  expect(beat).toHaveBeenCalledWith("g1");
  pending.mockResolvedValueOnce({ matchId: "m-1", mode: "sprint" });
  expect(await (await call()).json()).toEqual({
    challenge: { matchId: "m-1", mode: "sprint" },
  });
});

test("another site or no session: refused, and nobody is marked", async () => {
  current.mockResolvedValue(guest);
  expect((await call("https://evil.example")).status).toBe(403);
  current.mockResolvedValue(null);
  expect((await call()).status).toBe(401);
  expect(beat).not.toHaveBeenCalled();
});
