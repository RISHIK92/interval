import { type NextFetchEvent, NextRequest } from "next/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Actor } from "./server/ports";

// Visits for session_started (owner, 2026-10-25): a visit starts on the first request
// after 30 minutes without activity.
const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
const emit = vi.fn();
const flush = vi.fn(() => Promise.resolve());
vi.mock("./server/container", () => ({
  sessionReader: () => ({ current }),
  events: () => ({ emit, flush }),
}));
let publicUrl = "http://localhost:3100";
vi.mock("./env", () => ({ env: () => ({ BETTER_AUTH_URL: publicUrl }) }));

const NOW = Date.parse("2026-10-25T12:00:00.000Z");
const seconds = (ms: number): string => String(Math.floor(ms / 1000));
const account: Actor = { userId: "a1", isGuest: false, betaGroup: "developer" };
let waited: Promise<unknown>[];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  waited = [];
  publicUrl = "http://localhost:3100";
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

async function visit(cookie?: string) {
  const { proxy } = await import("./proxy");
  const request = new NextRequest("http://localhost:3100/", {
    headers: cookie === undefined ? {} : { cookie: `iv_visit=${cookie}` },
  });
  // The proxy uses only waitUntil; NextFetchEvent has no public constructor.
  const event = {
    waitUntil: (p: Promise<unknown>) => waited.push(p),
  } as unknown as NextFetchEvent;
  const response = await proxy(request, event);
  await Promise.all(waited);
  return response.cookies.get("iv_visit");
}

test("a first request from a signed-in user starts a visit and emits session_started", async () => {
  current.mockResolvedValue(account);
  const cookie = await visit();
  expect(cookie?.value).toMatch(
    new RegExp(`^[0-9a-f-]{36}\\.${seconds(NOW)}$`),
  );
  expect(cookie).toMatchObject({
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 1800,
    secure: false,
  });
  expect(emit).toHaveBeenCalledExactlyOnceWith(
    "session_started",
    {},
    { ...account, sessionId: cookie?.value.split(".")[0] },
  );
  // The proxy can end before the emitter's timer fires, so it waits for the flush.
  expect(waited).toHaveLength(1);
  expect(flush).toHaveBeenCalledOnce();
});

test("without a user there is no visit yet, so signing in starts one", async () => {
  current.mockResolvedValue(null);
  expect(await visit()).toBeUndefined();
  expect(emit).not.toHaveBeenCalled();
});

test("within 30 minutes the visit continues: no event, no session lookup", async () => {
  const cookie = await visit(`visit-1.${seconds(NOW - 10 * 60_000)}`);
  expect(cookie?.value).toBe(`visit-1.${seconds(NOW)}`);
  expect(current).not.toHaveBeenCalled();
  expect(emit).not.toHaveBeenCalled();
});

test("activity in the last minute does not rewrite the cookie", async () => {
  expect(await visit(`visit-1.${seconds(NOW - 30_000)}`)).toBeUndefined();
  expect(emit).not.toHaveBeenCalled();
});

test("the visit ends at exactly 30 minutes idle", async () => {
  current.mockResolvedValue(account);
  await visit(`visit-1.${seconds(NOW - 1799_000)}`);
  expect(emit).not.toHaveBeenCalled();
  const cookie = await visit(`visit-1.${seconds(NOW - 1800_000)}`);
  expect(cookie?.value.startsWith("visit-1.")).toBe(false);
  expect(emit).toHaveBeenCalledOnce();
});

test("a malformed cookie counts as no visit", async () => {
  current.mockResolvedValue(account);
  await visit("garbage");
  expect(emit).toHaveBeenCalledOnce();
});

// Behind CloudFront and the ALB the app sees http, so Secure follows the public origin.
test("an https site gets a Secure cookie whatever the request scheme", async () => {
  publicUrl = "https://interval.rishiklabs.tech";
  current.mockResolvedValue(account);
  expect((await visit())?.secure).toBe(true);
});

test("a failed session lookup is logged and never breaks the page", async () => {
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  current.mockRejectedValue(new Error("db down"));
  expect(await visit()).toBeUndefined();
  expect(emit).not.toHaveBeenCalled();
});

// Q-P1-16: the chosen time chip lasts for the browser session (owner, 2026-10-26).
async function chipAfter(path: string) {
  const { proxy } = await import("./proxy");
  const request = new NextRequest(`http://localhost:3100${path}`, {
    // A live visit, so only the chip can set a cookie.
    headers: { cookie: `iv_visit=visit-1.${seconds(NOW - 30_000)}` },
  });
  const event = { waitUntil: () => undefined } as unknown as NextFetchEvent;
  return (await proxy(request, event)).cookies.get("iv_chip");
}

test("a chip link remembers the chip in a session cookie", async () => {
  const cookie = await chipAfter("/?chip=1-3");
  expect(cookie).toMatchObject({
    value: "1-3",
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });
  // A session cookie: no expiry, so it ends when the browser does.
  expect(cookie?.maxAge).toBeUndefined();
  expect(cookie?.expires).toBeUndefined();
});

test("an unknown chip or no chip leaves the cookie alone", async () => {
  expect(await chipAfter("/?chip=99")).toBeUndefined();
  expect(await chipAfter("/")).toBeUndefined();
});

// ADR-0018: a reader open feeds Now reading like a browser open (owner, 2026-10-26).
async function readingAfter(path: string) {
  const { proxy } = await import("./proxy");
  const request = new NextRequest(`http://localhost:3100${path}`, {
    headers: { cookie: `iv_visit=visit-1.${seconds(NOW - 30_000)}` },
  });
  const event = { waitUntil: () => undefined } as unknown as NextFetchEvent;
  return (await proxy(request, event)).cookies.get("iv_reading");
}

test("opening the in-app reader remembers what it shows for Now reading", async () => {
  const cookie = await readingAfter("/read/5?moment=9&chip=3-8&pos=4");
  expect(cookie).toMatchObject({ value: "5.9", httpOnly: true, path: "/" });
  expect(cookie?.maxAge).toBeUndefined();
  expect((await readingAfter("/read/5?chip=3-8&from=continue"))?.value).toBe(
    "5.",
  );
});

test("anything else, or a reader URL with bad ids, leaves Now reading alone", async () => {
  expect(await readingAfter("/?chip=3-8")).toBeUndefined();
  expect(await readingAfter("/read/x?moment=9&chip=3-8")).toBeUndefined();
  expect(await readingAfter("/read/5?moment=9x&chip=3-8")).toBeUndefined();
  expect(await readingAfter("/read/5/more")).toBeUndefined();
  // Shapes the reader turns away: no chip, or neither or both of pos and from.
  expect(await readingAfter("/read/5?moment=9")).toBeUndefined();
  expect(await readingAfter("/read/5?moment=9&chip=3-8")).toBeUndefined();
  expect(
    await readingAfter("/read/5?moment=9&chip=3-8&pos=1&from=continue"),
  ).toBeUndefined();
});
