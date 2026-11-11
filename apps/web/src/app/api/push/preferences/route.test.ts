import { PushPreferences } from "@interval/api-client";
import { afterEach, expect, test, vi } from "vitest";
import type { Actor } from "../../../../server/ports";

// P4-W24-S01 (Q-P4-13): which pushes and when, from the web's Profile and the app's.
const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
const can = vi.fn(() => Promise.resolve(true));
const get = vi.fn();
const save = vi.fn();
const emit = vi.fn();
vi.mock("../../../../server/container", () => ({
  sessionReader: () => ({ current }),
  entitlements: () => ({ can }),
  pushSettings: () => ({ get, save }),
  events: () => ({ emit }),
}));
vi.mock("../../../../env", () => ({
  env: () => ({
    BETTER_AUTH_URL: "http://localhost:3100",
    NODE_ENV: "production",
  }),
}));

const account: Actor = { userId: "u1", isGuest: false, betaGroup: "student" };
const APP = { "expo-origin": "interval://", "interval-platform": "android" };
// What Intl calls it on this runtime (ICU may say "Asia/Calcutta", an alias zoneinfo
// knows too).
const KOLKATA = new Intl.DateTimeFormat("en", {
  timeZone: "Asia/Kolkata",
}).resolvedOptions().timeZone;
const ON = {
  digest: true,
  pathReminder: false,
  dailyChallenge: true,
  hour: 9,
};
afterEach(() => {
  vi.clearAllMocks();
});
const call = async (
  method: "GET" | "PUT",
  body?: unknown,
  headers: Record<string, string> = APP,
) => {
  const route = await import("./route");
  const request = new Request("http://localhost:3100/api/push/preferences", {
    method,
    headers: { "content-type": "application/json", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return method === "GET" ? route.GET(request) : route.PUT(request);
};

test("read, as the app parses it, without an Origin", async () => {
  current.mockResolvedValue(account);
  get.mockResolvedValueOnce(ON);
  const got = await call("GET", undefined, {});
  expect(got.status).toBe(200);
  expect(PushPreferences.parse(await got.json())).toEqual(ON);
});

test("saved with the device's zone; each kind turned on or off counts", async () => {
  current.mockResolvedValue(account);
  save.mockResolvedValueOnce([
    { kind: "digest", on: true },
    { kind: "daily_challenge", on: true },
  ]);
  expect((await call("PUT", { ...ON, timeZone: "Asia/Kolkata" })).status).toBe(
    204,
  );
  expect(save).toHaveBeenCalledWith("u1", ON, KOLKATA);
  expect(emit).toHaveBeenCalledWith(
    "push_setting_changed",
    { kind: "digest", on: true },
    expect.objectContaining({ source: "android" }),
  );
  expect(emit).toHaveBeenCalledTimes(2);
});

test("a zone is stored in Intl's own spelling", async () => {
  current.mockResolvedValue(account);
  save.mockResolvedValueOnce([]);
  expect((await call("PUT", { ...ON, timeZone: "asia/kolkata" })).status).toBe(
    204,
  );
  expect(save).toHaveBeenCalledWith("u1", ON, KOLKATA);
});

test("refused: no session, a guest, no push.notify, another site, a bad body", async () => {
  current.mockResolvedValue(null);
  expect((await call("GET")).status).toBe(401);
  current.mockResolvedValue({ ...account, isGuest: true });
  expect((await call("PUT", { ...ON, timeZone: "UTC" })).status).toBe(401);
  current.mockResolvedValue(account);
  can.mockResolvedValueOnce(false);
  expect((await call("GET")).status).toBe(403);
  expect((await call("PUT", { ...ON, timeZone: "UTC" }, {})).status).toBe(403);
  expect((await call("PUT", { ...ON, timeZone: "Mars/Olympus" })).status).toBe(
    400,
  );
  expect((await call("PUT", { ...ON, hour: 22, timeZone: "UTC" })).status).toBe(
    400,
  );
  expect((await call("PUT", { ...ON })).status).toBe(400);
  // A bare offset: Intl takes it, the worker's zoneinfo doesn't.
  expect((await call("PUT", { ...ON, timeZone: "+05:30" })).status).toBe(400);
  expect(save).not.toHaveBeenCalled();
});
