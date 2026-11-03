import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { expect, test, vi } from "vitest";

// Q-P1-31 (owner, 2026-10-26): the service worker keeps only the offline page and
// answers only navigations, so no signed-in page is ever cached.
type Listener = (event: Record<string, unknown>) => void;

function load(fetchImpl: (request: unknown) => Promise<Response>) {
  const listeners = new Map<string, Listener>();
  const stored = new Map<string, Response>();
  const cache = {
    add: (url: string) => {
      stored.set(url, new Response("offline page"));
      return Promise.resolve();
    },
    put: vi.fn(),
    addAll: vi.fn(),
  };
  const caches = {
    open: () => Promise.resolve(cache),
    // An older version's cache, left from a previous install.
    keys: () => Promise.resolve(["interval-offline-v0"]),
    delete: vi.fn(() => Promise.resolve(true)),
    match: (url: string) => Promise.resolve(stored.get(url)),
  };
  const windows: { focus: () => Promise<void> }[] = [];
  const self = {
    addEventListener: (type: string, listener: Listener) =>
      listeners.set(type, listener),
    skipWaiting: vi.fn(),
    clients: {
      claim: vi.fn(() => Promise.resolve()),
      matchAll: vi.fn(() => Promise.resolve(windows)),
      openWindow: vi.fn(() => Promise.resolve()),
    },
    registration: {
      showNotification: vi.fn(() => Promise.resolve()),
      pushManager: {
        subscribe: vi.fn(() =>
          Promise.resolve({
            toJSON: () => ({
              endpoint: "https://fcm.googleapis.com/fcm/send/new",
            }),
          }),
        ),
      },
    },
  };
  runInNewContext(
    readFileSync(join(__dirname, "..", "..", "public", "sw.js"), "utf8"),
    {
      self,
      caches,
      fetch: fetchImpl,
      Response,
      Promise,
    },
  );
  async function dispatch(type: string, extra: Record<string, unknown> = {}) {
    let waited: Promise<unknown> | undefined;
    let responded: Promise<Response> | undefined;
    listeners.get(type)?.({
      ...extra,
      waitUntil: (p: Promise<unknown>) => (waited = p),
      respondWith: (p: Promise<Response>) => (responded = p),
    });
    await waited;
    return responded;
  }
  return { dispatch, stored, cache, caches, self, windows };
}

test("install caches only the offline page; activate drops older caches", async () => {
  const sw = load(() => Promise.reject(new Error("unused")));
  await sw.dispatch("install");
  expect([...sw.stored.keys()]).toEqual(["/offline"]);
  await sw.dispatch("activate");
  expect(sw.caches.delete).toHaveBeenCalledWith("interval-offline-v0");
});

test("a navigation goes to the network and is never cached", async () => {
  const page = new Response("feed");
  const sw = load(() => Promise.resolve(page));
  await sw.dispatch("install");
  const response = await sw.dispatch("fetch", {
    request: { mode: "navigate" },
  });
  expect(response).toBe(page);
  expect(sw.cache.put).not.toHaveBeenCalled();
  expect(sw.cache.addAll).not.toHaveBeenCalled();
});

test("a failed navigation falls back to the offline page", async () => {
  const sw = load(() => Promise.reject(new TypeError("offline")));
  await sw.dispatch("install");
  const response = await sw.dispatch("fetch", {
    request: { mode: "navigate" },
  });
  expect(await response?.text()).toBe("offline page");
});

test("anything that isn't a navigation is left to the browser", async () => {
  const sw = load(() => Promise.reject(new Error("unused")));
  expect(
    await sw.dispatch("fetch", { request: { mode: "cors" } }),
  ).toBeUndefined();
});

// P3-W17-S05b (§7): the agent's nudge shows its fixed text; a click comes back to
// Interval, an open window first.
test("a push shows the nudge; a click focuses Interval or opens it", async () => {
  const sw = load(() => Promise.reject(new Error("unused")));
  await sw.dispatch("push", {
    data: {
      json: () => ({
        title: "Your agent is still working",
        body: "Open Interval for a quick session",
        url: "/",
      }),
    },
  });
  expect(sw.self.registration.showNotification).toHaveBeenCalledWith(
    "Your agent is still working",
    expect.objectContaining({
      body: "Open Interval for a quick session",
      tag: "agent-nudge",
      data: { url: "/" },
    }),
  );
  const close = vi.fn();
  await sw.dispatch("notificationclick", { notification: { close } });
  expect(close).toHaveBeenCalled();
  expect(sw.self.clients.openWindow).toHaveBeenCalledWith("/");
  const focus = vi.fn(() => Promise.resolve());
  sw.windows.push({ focus });
  await sw.dispatch("notificationclick", { notification: { close } });
  expect(focus).toHaveBeenCalled();
});

test("a push with no readable payload still shows the nudge", async () => {
  const sw = load(() => Promise.reject(new Error("unused")));
  await sw.dispatch("push", {
    data: {
      json: () => {
        throw new SyntaxError("bad");
      },
    },
  });
  expect(sw.self.registration.showNotification).toHaveBeenCalledWith(
    "Your agent is still working",
    expect.anything(),
  );
});

// A rotated subscription is renewed and told to Interval, as the Profile button does.
test("a replaced subscription is renewed and saved", async () => {
  const fetched: Request[] = [];
  const sw = load((request) => {
    fetched.push(request as Request);
    return Promise.resolve(new Response(null, { status: 204 }));
  });
  const options = { userVisibleOnly: true, applicationServerKey: "k" };
  await sw.dispatch("pushsubscriptionchange", { oldSubscription: { options } });
  expect(sw.self.registration.pushManager.subscribe).toHaveBeenCalledWith(
    options,
  );
  expect(fetched).toHaveLength(1);
});
