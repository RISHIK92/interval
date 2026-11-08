import { afterEach, expect, test, vi } from "vitest";
import type { Actor, PushSubscriptions } from "../../../../server/ports";

// P3-W17-S05b: a browser subscribes (accounts only), checked at the boundary; it
// unsubscribes its own.
const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
const save = vi.fn<PushSubscriptions["save"]>(() => Promise.resolve());
const remove = vi.fn<PushSubscriptions["remove"]>(() => Promise.resolve());
let configured = true;
// ADR-0036: the route checks its capability; granted unless a test says not.
const can = vi.fn<(userId: string, capability: string) => Promise<boolean>>(
  () => Promise.resolve(true),
);
vi.mock("../../../../server/container", () => ({
  entitlements: () => ({ can }),
  sessionReader: () => ({ current }),
  pushSubscriptions: () => ({ save, remove }),
}));
vi.mock("../../../../env", () => ({
  env: () => ({
    BETTER_AUTH_URL: "http://localhost:3100",
    NODE_ENV: "production",
  }),
  pushEnv: () => (configured ? { VAPID_PUBLIC_KEY: "B" } : null),
}));

const account: Actor = { userId: "u1", isGuest: false, betaGroup: "student" };
const guest: Actor = { ...account, isGuest: true };

afterEach(() => {
  vi.clearAllMocks();
  configured = true;
});

const subscription = {
  endpoint: "https://fcm.googleapis.com/fcm/send/abc",
  keys: { p256dh: `B${"a".repeat(86)}`, auth: "b".repeat(22) },
};

const call = async (
  method: "POST" | "DELETE",
  body: unknown,
  origin = "http://localhost:3100",
) => {
  const route = await import("./route");
  return route[method](
    new Request("http://localhost:3100/api/push/subscription", {
      method,
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
};

test("the browsers' push services are taken", async () => {
  current.mockResolvedValue(account);
  for (const endpoint of [
    "https://updates.push.services.mozilla.com/wpush/v2/x",
    "https://web.push.apple.com/x",
    "https://wns2-db5p.notify.windows.com/w/?token=x",
  ])
    expect((await call("POST", { ...subscription, endpoint })).status).toBe(
      204,
    );
});

test("an account's browser subscribes and unsubscribes", async () => {
  current.mockResolvedValue(account);
  expect((await call("POST", subscription)).status).toBe(204);
  expect(save).toHaveBeenCalledWith("u1", {
    endpoint: subscription.endpoint,
    p256dh: subscription.keys.p256dh,
    auth: subscription.keys.auth,
  });
  expect(
    (await call("DELETE", { endpoint: subscription.endpoint })).status,
  ).toBe(204);
  expect(remove).toHaveBeenCalledWith("u1", subscription.endpoint);
});

test.each([
  [{ ...subscription, endpoint: "http://push.example/x" }],
  [{ ...subscription, endpoint: "javascript:alert(1)" }],
  [{ ...subscription, endpoint: "https://10.0.0.5/internal" }],
  [{ ...subscription, endpoint: "https://push.apple.com.evil.example/x" }],
  [{ ...subscription, endpoint: "https://fcm.googleapis.com:8443/x" }],
  [{ ...subscription, keys: { ...subscription.keys, auth: "short" } }],
  [{ endpoint: subscription.endpoint }],
])("a subscription that isn't one is refused (%j)", async (body) => {
  current.mockResolvedValue(account);
  expect((await call("POST", body)).status).toBe(400);
  expect(save).not.toHaveBeenCalled();
});

test("a guest, another site, or push not configured: refused", async () => {
  current.mockResolvedValue(guest);
  expect((await call("POST", subscription)).status).toBe(401);
  current.mockResolvedValue(account);
  expect(
    (await call("POST", subscription, "https://evil.example")).status,
  ).toBe(403);
  configured = false;
  expect((await call("POST", subscription)).status).toBe(503);
  expect(save).not.toHaveBeenCalled();
});

// ADR-0036: web push has its own capability.
test("without push.notify, subscribing and unsubscribing answer 403", async () => {
  current.mockResolvedValue(account);
  can.mockResolvedValue(false);
  expect((await call("POST", subscription)).status).toBe(403);
  expect(save).not.toHaveBeenCalled();
  // Removing an endpoint (personal data) stays open after a downgrade.
  expect(
    (await call("DELETE", { endpoint: subscription.endpoint })).status,
  ).toBe(204);
  expect(can).toHaveBeenCalledWith("u1", "push.notify");
  can.mockResolvedValue(true);
});
