import { afterEach, expect, test, vi } from "vitest";
import type { Actor } from "../../../server/ports";

// P4-W21-S01 (§6.3, Q-P2-14): starting a game or Test 60s from the app.
const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
const startGame = vi.fn();
const startTest = vi.fn();
const startCheckpoint = vi.fn();
vi.mock("../../../server/container", () => ({
  sessionReader: () => ({ current }),
}));
vi.mock("../../../server/quiz-flow", () => ({
  startCheckpoint,
  startGame,
  startTest,
}));
vi.mock("../../../env", () => ({
  env: () => ({
    BETTER_AUTH_URL: "http://localhost:3100",
    NODE_ENV: "production",
  }),
}));

const account: Actor = { userId: "u1", isGuest: false, betaGroup: "student" };
const APP = { "expo-origin": "interval://", "interval-platform": "ios" };
afterEach(() => {
  vi.clearAllMocks();
});
const post = async (body: unknown, headers: Record<string, string> = APP) => {
  const { POST } = await import("./route");
  return POST(
    new Request("http://localhost:3100/api/quiz", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
  );
};

test("a game starts with the app's source; a plan without it, or nothing to play", async () => {
  current.mockResolvedValue(account);
  startGame.mockResolvedValueOnce({ attemptId: "40" });
  const started = await post({ game: "daily" });
  expect(started.status).toBe(201);
  expect(await started.json()).toEqual({ attemptId: "40" });
  expect(startGame).toHaveBeenCalledWith(
    expect.objectContaining({ userId: "u1", source: "ios", sessionId: null }),
    "daily",
  );
  startGame.mockResolvedValueOnce("forbidden");
  expect((await post({ game: "sprint" })).status).toBe(403);
  startGame.mockResolvedValueOnce("none");
  expect((await post({ game: "estimation" })).status).toBe(404);
});

test("Test 60s on a section, or none live", async () => {
  current.mockResolvedValue(account);
  startTest.mockResolvedValueOnce({ attemptId: "41" });
  expect((await post({ itemId: "5", momentId: "9" })).status).toBe(201);
  expect(startTest).toHaveBeenCalledWith(expect.anything(), "5", "9");
  startTest.mockResolvedValueOnce(null);
  expect((await post({ itemId: "5" })).status).toBe(404);
  expect(startTest).toHaveBeenLastCalledWith(expect.anything(), "5", null);
});

test("no session, another site or a bad body: refused", async () => {
  current.mockResolvedValue(null);
  expect((await post({ game: "sprint" })).status).toBe(401);
  current.mockResolvedValue(account);
  expect((await post({ game: "sprint" }, {})).status).toBe(403);
  expect((await post({ game: "chess" })).status).toBe(400);
  expect((await post({ itemId: "x" })).status).toBe(400);
  expect(startGame).not.toHaveBeenCalled();
});

// P4-W21-S03 (§5F): a path's checkpoint, for accounts (guests have no paths).
test("a checkpoint on a path section; not ready, or a guest: 404", async () => {
  current.mockResolvedValue(account);
  startCheckpoint.mockResolvedValueOnce({ attemptId: "42" });
  expect((await post({ sectionId: "12" })).status).toBe(201);
  expect(startCheckpoint).toHaveBeenCalledWith(expect.anything(), "12");
  startCheckpoint.mockResolvedValueOnce(null);
  expect((await post({ sectionId: "12" })).status).toBe(404);
  current.mockResolvedValue({ ...account, isGuest: true });
  expect((await post({ sectionId: "12" })).status).toBe(404);
  expect(startCheckpoint).toHaveBeenCalledTimes(2);
});
