import { beforeEach, expect, test, vi } from "vitest";
import type {
  Actor,
  Entitlements,
  LldPractice,
  LoadedProblem,
} from "../../../../../server/ports";
import type { PracticeStart } from "../../../../../server/battles";

// ADR-0048 (Q-WD-28): the practice page's autosave and session start check everything
// they're sent: the player, the problem's pool, the language, the size, the version.
const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
const can = vi.fn<Entitlements["can"]>(() => Promise.resolve(true));
const saveCode = vi.fn<LldPractice["saveCode"]>(() => Promise.resolve(3));
const get = vi.fn<(slug: string) => Promise<Partial<LoadedProblem> | null>>();
const start = vi.fn<() => Promise<PracticeStart>>();
const emit = vi.fn();
let gameConfigured = true;
vi.mock("../../../../../server/container", () => ({
  sessionReader: () => ({ current }),
  entitlements: () => ({ can }),
  lldPractice: () => ({ saveCode }),
  problems: () => ({ get }),
  practiceDeps: () => ({}),
  events: () => ({ emit }),
}));
vi.mock("../../../../../server/battles", () => ({
  startPracticeSession: start,
}));
vi.mock("../../../../../env", () => ({
  gameEnv: () => (gameConfigured ? { GAME_TICKET_SECRET: "s" } : null),
}));
vi.mock("next/headers", () => ({
  headers: () => Promise.resolve(new Headers()),
  cookies: () => Promise.resolve({ get: () => undefined }),
}));

const { saveCode: save, startSession } = await import("./actions");
const ada: Actor = { userId: "u1", isGuest: false, betaGroup: "student" };
const practice = { slug: "lru-cache", pool: "practice", difficulty: "easy" };

beforeEach(() => {
  gameConfigured = true;
  current.mockResolvedValue(ada);
  can.mockResolvedValue(true);
  get.mockResolvedValue(practice as Partial<LoadedProblem>);
  saveCode.mockClear();
  start.mockReset();
  emit.mockClear();
});

test("code saves over the version it was made from", async () => {
  expect(await save("lru-cache", "python", "class A: ...", 2)).toEqual({
    ok: true,
    version: 3,
  });
  expect(saveCode).toHaveBeenCalledWith(
    "u1",
    "lru-cache",
    "python",
    "class A: ...",
    2,
  );
});

test("a stale save is reported, not forced", async () => {
  saveCode.mockResolvedValueOnce(null);
  expect(await save("lru-cache", "python", "x", 1)).toEqual({
    ok: false,
    reason: "stale",
  });
});

test("signed out, or without battles, nothing is saved", async () => {
  current.mockResolvedValueOnce(null);
  expect(await save("lru-cache", "python", "x", 0)).toEqual({
    ok: false,
    reason: "signed-out",
  });
  can.mockResolvedValueOnce(false);
  expect(await save("lru-cache", "python", "x", 0)).toEqual({
    ok: false,
    reason: "forbidden",
  });
  expect(saveCode).not.toHaveBeenCalled();
});

test.each([
  ["a language no battle has", "lru-cache", "cobol", "x", 0],
  ["code that isn't text", "lru-cache", "python", 7, 0],
  ["a negative version", "lru-cache", "python", "x", -1],
  ["a version that isn't a number", "lru-cache", "python", "x", "2"],
  ["too much code", "lru-cache", "python", "é".repeat(128 * 1024 + 1), 0],
])("%s is refused and nothing is saved", async (_, s, l, c, v) => {
  expect(await save(s, l, c, v)).toMatchObject({ ok: false });
  expect(saveCode).not.toHaveBeenCalled();
});

test("a battle problem, or none, is no practice problem", async () => {
  get.mockResolvedValueOnce({ slug: "rate-limiter", pool: "battle" });
  expect(await save("rate-limiter", "python", "x", 0)).toEqual({
    ok: false,
    reason: "invalid",
  });
  get.mockResolvedValueOnce(null);
  expect(await save("nope", "python", "x", 0)).toEqual({
    ok: false,
    reason: "invalid",
  });
  expect(saveCode).not.toHaveBeenCalled();
});

test("a session started is said once; an open one is gone back to", async () => {
  start.mockResolvedValueOnce({
    status: "started",
    matchId: "m1",
    problem: practice as LoadedProblem,
  });
  expect(await startSession("lru-cache", null)).toEqual({
    ok: true,
    matchId: "m1",
  });
  expect(emit).toHaveBeenCalledWith(
    "lld_practice_started",
    { problem_slug: "lru-cache", difficulty: "easy" },
    expect.objectContaining({ userId: "u1" }),
  );
  start.mockResolvedValueOnce({ status: "open", matchId: "m1" });
  expect(await startSession("lru-cache", null)).toEqual({
    ok: true,
    matchId: "m1",
  });
  expect(emit).toHaveBeenCalledTimes(1);
});

test("a session isn't started for the wrong player, problem or rate", async () => {
  current.mockResolvedValueOnce(null);
  expect(await startSession("lru-cache", null)).toEqual({
    ok: false,
    reason: "signed-out",
  });
  can.mockResolvedValueOnce(true).mockResolvedValueOnce(false); // battles, not live
  expect(await startSession("lru-cache", null)).toEqual({
    ok: false,
    reason: "forbidden",
  });
  expect(await startSession("lru-cache", 7)).toEqual({
    ok: false,
    reason: "invalid",
  });
  start.mockResolvedValueOnce({ status: "not-practice" });
  expect(await startSession("rate-limiter", null)).toEqual({
    ok: false,
    reason: "invalid",
  });
  start.mockResolvedValueOnce({ status: "limited" });
  expect(await startSession("lru-cache", "m1")).toEqual({
    ok: false,
    reason: "limited",
  });
  gameConfigured = false;
  expect(await startSession("lru-cache", null)).toEqual({
    ok: false,
    reason: "unavailable",
  });
  expect(start).toHaveBeenCalledTimes(2);
});
