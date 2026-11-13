import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Actor, BattleWindows } from "../../../../server/ports";

// P5-W32 (Q-P5-12, Q-P5-19): registering for a ranked window, for players with
// battles and live play, only while it's open.
const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
const can = vi.fn<(userId: string, capability: string) => Promise<boolean>>(
  () => Promise.resolve(true),
);
const register = vi.fn<BattleWindows["register"]>(() => Promise.resolve());
const unregister = vi.fn<BattleWindows["unregister"]>(() => Promise.resolve());
vi.mock("../../../../server/container", () => ({
  sessionReader: () => ({ current }),
  entitlements: () => ({ can }),
  battleWindows: () => ({ register, unregister }),
}));
vi.mock("../../../../env", () => ({
  env: () => ({ BETTER_AUTH_URL: "http://localhost:3100" }),
  windowTimeZone: () => "UTC",
}));

const ada: Actor = { userId: "u1", isGuest: false, betaGroup: "student" };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
});
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

async function send(method: "POST" | "DELETE"): Promise<number> {
  const route = await import("./route");
  const res = await route[method](
    new Request("http://localhost:3100/api/battle/window", {
      method,
      headers: { origin: "http://localhost:3100" },
    }),
  );
  return res.status;
}

test("registering while open asks for the reminder 15 minutes before", async () => {
  vi.setSystemTime(new Date("2026-11-13T18:00:00Z")); // tonight's 21:00 UTC is open
  current.mockResolvedValue(ada);
  expect(await send("POST")).toBe(204);
  expect(register).toHaveBeenCalledWith(
    new Date("2026-11-13T21:00:00Z"),
    "u1",
    new Date("2026-11-13T20:45:00Z"),
    "human",
  );
  expect(await send("DELETE")).toBe(204);
});

test("closed 5 minutes before, and no leaving once grouping may start", async () => {
  vi.setSystemTime(new Date("2026-11-13T20:56:00Z"));
  current.mockResolvedValue(ada);
  expect(await send("POST")).toBe(409);
  expect(await send("DELETE")).toBe(409);
  expect(register).not.toHaveBeenCalled();
  expect(unregister).not.toHaveBeenCalled();
});

test("signed out, or a plan without battles, is refused", async () => {
  vi.setSystemTime(new Date("2026-11-13T18:00:00Z"));
  current.mockResolvedValue(null);
  expect(await send("POST")).toBe(401);
  current.mockResolvedValue(ada);
  can.mockResolvedValueOnce(false);
  expect(await send("POST")).toBe(403);
  expect(register).not.toHaveBeenCalled();
});
