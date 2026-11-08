import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Actor, DevicePushTokens } from "../../../../server/ports";

// P4-W19-S04a (Q-P4-03, ADR-0036): the app registers its phone's push token. It has no
// Origin; its expo-origin header (a custom header no other site can send without a
// preflight) stands for it.
const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
const save = vi.fn<DevicePushTokens["save"]>(() => Promise.resolve());
const remove = vi.fn<DevicePushTokens["remove"]>(() => Promise.resolve());
const can = vi.fn<(userId: string, capability: string) => Promise<boolean>>(
  () => Promise.resolve(true),
);
vi.mock("../../../../server/container", () => ({
  sessionReader: () => ({ current }),
  devicePushTokens: () => ({ save, remove }),
  entitlements: () => ({ can }),
}));
vi.mock("../../../../env", () => ({
  env: () => ({
    BETTER_AUTH_URL: "http://localhost:3100",
    NODE_ENV: "production",
  }),
}));

const account: Actor = { userId: "u1", isGuest: false, betaGroup: "student" };
const guest: Actor = { userId: "g1", isGuest: true, betaGroup: "student" };
const TOKEN = "a1b2c3d4".repeat(8);
const FROM_APP = { "expo-origin": "interval://" };

beforeEach(() => {
  can.mockResolvedValue(true);
});
afterEach(() => {
  vi.clearAllMocks();
});

const call = async (
  method: "POST" | "DELETE",
  body: unknown,
  headers: Record<string, string> = FROM_APP,
) => {
  const route = await import("./route");
  return route[method](
    new Request("http://localhost:3100/api/push/device", {
      method,
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
  );
};

test("the app registers and removes its phone's token", async () => {
  current.mockResolvedValue(account);
  expect((await call("POST", { platform: "ios", token: TOKEN })).status).toBe(
    204,
  );
  expect(save).toHaveBeenCalledWith("u1", "ios", TOKEN);
  expect((await call("DELETE", { token: TOKEN })).status).toBe(204);
  expect(remove).toHaveBeenCalledWith("u1", TOKEN);
});

test("another site, a guest, or a bad body: refused", async () => {
  current.mockResolvedValue(account);
  const ok = { platform: "android", token: "fcm:token_1-x" };
  expect((await call("POST", ok, {})).status).toBe(403); // no origin, no expo-origin
  expect(
    (await call("POST", ok, { origin: "https://evil.example" })).status,
  ).toBe(403);
  expect((await call("POST", ok, { "expo-origin": "evil://" })).status).toBe(
    403,
  );
  // A page elsewhere can't borrow the app's header: its own Origin comes too.
  expect(
    (
      await call("POST", ok, {
        origin: "https://evil.example",
        "expo-origin": "interval://",
      })
    ).status,
  ).toBe(403);
  expect(
    (await call("POST", { platform: "windows", token: TOKEN })).status,
  ).toBe(400);
  expect(
    (await call("POST", { platform: "ios", token: "bad token!" })).status,
  ).toBe(400);
  current.mockResolvedValue(guest);
  expect((await call("POST", ok)).status).toBe(401);
  expect(save).not.toHaveBeenCalled();
});

// ADR-0036: registering needs push.notify; removing stays open after a downgrade.
test("without push.notify, registering is 403 and removing still works", async () => {
  current.mockResolvedValue(account);
  can.mockResolvedValue(false);
  expect((await call("POST", { platform: "ios", token: TOKEN })).status).toBe(
    403,
  );
  expect((await call("DELETE", { token: TOKEN })).status).toBe(204);
  expect(save).not.toHaveBeenCalled();
  expect(can).toHaveBeenCalledWith("u1", "push.notify");
});

test("the web site's own origin is accepted too", async () => {
  current.mockResolvedValue(account);
  expect(
    (
      await call(
        "POST",
        { platform: "ios", token: TOKEN },
        { origin: "http://localhost:3100" },
      )
    ).status,
  ).toBe(204);
});
