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
  const self = {
    addEventListener: (type: string, listener: Listener) =>
      listeners.set(type, listener),
    skipWaiting: vi.fn(),
    clients: { claim: vi.fn(() => Promise.resolve()) },
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
  return { dispatch, stored, cache, caches };
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
