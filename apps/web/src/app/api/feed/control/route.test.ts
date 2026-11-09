import { afterEach, expect, test, vi } from "vitest";
import type { Actor } from "../../../../server/ports";

// P4-W20-S01 (§5C): the app's card menu, through the PWA's own controls.
const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
const applyControl = vi.fn(() => Promise.resolve(true));
const can = vi.fn(() => Promise.resolve(true));
vi.mock("../../../../server/container", () => ({
  entitlements: () => ({ can }),
  sessionReader: () => ({ current }),
}));
vi.mock("../../../../server/card-controls", () => ({ applyControl }));
vi.mock("../../../../env", () => ({
  env: () => ({
    BETTER_AUTH_URL: "http://localhost:3100",
    NODE_ENV: "production",
  }),
}));

const account: Actor = { userId: "u1", isGuest: false, betaGroup: "student" };
const APP = { "expo-origin": "interval://", "interval-platform": "android" };

afterEach(() => {
  vi.clearAllMocks();
});

const post = async (body: unknown, headers: Record<string, string> = APP) => {
  const { POST } = await import("./route");
  return POST(
    new Request("http://localhost:3100/api/feed/control", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
  );
};

test("a control applies as the PWA's does, its events from android", async () => {
  current.mockResolvedValue(account);
  for (const control of ["save", "not_interested", "hide_source"]) {
    expect((await post({ itemId: "5", control })).status).toBe(204);
  }
  expect(applyControl).toHaveBeenCalledWith(
    account,
    "5",
    "not_interested",
    expect.objectContaining({ source: "android", sessionId: null }),
  );
});

test("a guest, another site or a bad body: refused", async () => {
  current.mockResolvedValue({ ...account, isGuest: true });
  expect((await post({ itemId: "5", control: "save" })).status).toBe(401);
  current.mockResolvedValue(account);
  expect((await post({ itemId: "5", control: "save" }, {})).status).toBe(403);
  expect((await post({ itemId: "x", control: "save" })).status).toBe(400);
  expect((await post({ itemId: "5", control: "delete" })).status).toBe(400);
  expect(applyControl).not.toHaveBeenCalled();
});

test("a plan without the feed can't act on it", async () => {
  current.mockResolvedValue(account);
  can.mockResolvedValueOnce(false);
  expect((await post({ itemId: "5", control: "save" })).status).toBe(403);
  expect(applyControl).not.toHaveBeenCalled();
});
