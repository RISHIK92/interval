import { PlayResponse } from "@interval/api-client";
import { afterEach, expect, test, vi } from "vitest";
import type { Actor, DailyStatus } from "../../../server/ports";

// P4-W21-S01 (§6.3, OPS-3): what Play offers in the app.
const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
const can = vi.fn((_: string, capability: string) =>
  Promise.resolve(capability !== "play.estimation"),
);
const dailyStatus = vi.fn<() => Promise<DailyStatus>>(() =>
  Promise.resolve({ today: "open", streak: { days: 3, freezes: 1 } }),
);
vi.mock("../../../server/container", () => ({
  sessionReader: () => ({ current }),
  entitlements: () => ({ can }),
  quizzes: () => ({ dailyStatus }),
}));
vi.mock("../../../env", () => ({
  env: () => ({
    BETTER_AUTH_URL: "http://localhost:3100",
    NODE_ENV: "production",
  }),
}));

const guest: Actor = { userId: "g1", isGuest: true, betaGroup: "student" };
const APP = { "expo-origin": "interval://" };
afterEach(() => {
  vi.clearAllMocks();
});
const get = async (headers: Record<string, string> = APP) => {
  const { GET } = await import("./route");
  return GET(new Request("http://localhost:3100/api/play", { headers }));
};

test("the plan's games and today's challenge, guests included", async () => {
  current.mockResolvedValue(guest);
  const body = PlayResponse.parse(await (await get()).json());
  expect(body).toEqual({
    games: { sprint: true, estimation: false, daily: true },
    daily: { today: "open", streak: { days: 3, freezes: 1 } },
  });
  expect(dailyStatus).toHaveBeenCalledWith("g1");
});

test("no session or another site: refused", async () => {
  current.mockResolvedValue(null);
  expect((await get()).status).toBe(401);
  current.mockResolvedValue(guest);
  expect((await get({})).status).toBe(403);
});
