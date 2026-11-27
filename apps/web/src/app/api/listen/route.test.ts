import { ListenResponse } from "@interval/api-client";
import { afterEach, expect, test, vi } from "vitest";
import type { Actor } from "../../../server/ports";

// P4-W23-S01 (§5G, §5I): the audio queue and the reader's Listen.
const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
const queue = vi.fn();
const voiced = vi.fn<() => Promise<string[]>>();
const add = vi.fn<(userId: string, ids: string[]) => Promise<string[]>>(
  (_userId, ids) => Promise.resolve(ids),
);
const emit = vi.fn();
vi.mock("../../../server/container", () => ({
  sessionReader: () => ({ current }),
  listening: () => ({ queue, voiced, add }),
  events: () => ({ emit }),
}));
vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) =>
        name === "iv_visit" ? { name, value: "visit-1.1790000000" } : undefined,
    }),
}));
vi.mock("../../../env", () => ({
  env: () => ({
    BETTER_AUTH_URL: "http://localhost:3100",
    NODE_ENV: "production",
  }),
}));

const account: Actor = { userId: "u1", isGuest: false, betaGroup: "student" };
const APP = { "expo-origin": "interval://", "interval-platform": "ios" };
afterEach(() => {
  vi.clearAllMocks();
});
const call = async (
  method: "GET" | "POST",
  body?: unknown,
  headers: Record<string, string> = APP,
) => {
  const route = await import("./route");
  const request = new Request("http://localhost:3100/api/listen", {
    method,
    headers: { "content-type": "application/json", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return method === "GET" ? route.GET(request) : route.POST(request);
};

const view = {
  queue: [
    {
      explainerId: "7",
      conceptId: "3",
      concept: "Raft",
      src: "/media/explainers/3/7/r/index.m3u8",
      durationSeconds: 90,
      positionSeconds: 12,
      sources: [{ title: "Elections — Raft", href: "https://a.test/r#e" }],
      captions: [],
      scene: null,
    },
  ],
  upNext: null,
};

test("the queue, as the app parses it", async () => {
  current.mockResolvedValue(account);
  queue.mockResolvedValueOnce(view);
  const got = await call("GET");
  expect(got.status).toBe(200);
  expect(ListenResponse.parse(await got.json())).toEqual(view);
  expect(queue).toHaveBeenCalledWith("u1");
});

// The PWA's own fetch: a same-origin GET carries no Origin header.
test("the site reads the queue without an Origin header", async () => {
  current.mockResolvedValue(account);
  queue.mockResolvedValueOnce(view);
  expect((await call("GET", undefined, {})).status).toBe(200);
});

test("Listen queues what the section has voiced; nothing voiced is 404", async () => {
  current.mockResolvedValue(account);
  voiced.mockResolvedValueOnce(["7", "8"]);
  const got = await call("POST", { itemId: "5", momentId: "9" });
  expect(got.status).toBe(201);
  expect(await got.json()).toEqual({ first: "7" });
  expect(voiced).toHaveBeenCalledWith("5", "9");
  expect(add).toHaveBeenCalledWith("u1", ["7", "8"]);
  voiced.mockResolvedValueOnce([]);
  expect((await call("POST", { itemId: "5" })).status).toBe(404);
  expect(voiced).toHaveBeenLastCalledWith("5", null);
  expect(add).toHaveBeenCalledTimes(1);
});

test("no session, a guest, another site or a bad body: refused", async () => {
  current.mockResolvedValue(null);
  expect((await call("GET")).status).toBe(401);
  current.mockResolvedValue({ ...account, isGuest: true });
  expect((await call("POST", { itemId: "5" })).status).toBe(401);
  current.mockResolvedValue(account);
  expect((await call("POST", { itemId: "5" }, {})).status).toBe(403);
  expect((await call("POST", { itemId: "x" })).status).toBe(400);
  expect(queue).not.toHaveBeenCalled();
  expect(voiced).not.toHaveBeenCalled();
});

// ADR-0044: an "Also fits" card queues its one explainer and is recorded as the grid's.
test("Also fits queues one explainer, recorded with its place; one not voiced is 404", async () => {
  current.mockResolvedValue(account);
  const alsoFits = { position: 3, chip: "3-8" };
  const got = await call("POST", { explainerId: "7", alsoFits });
  expect(got.status).toBe(201);
  expect(await got.json()).toEqual({ first: "7" });
  expect(add).toHaveBeenCalledWith("u1", ["7"]);
  expect(voiced).not.toHaveBeenCalled();
  expect(emit).toHaveBeenCalledWith(
    "also_fits_opened",
    { kind: "explainer", position: 3, chip: "3-8" },
    { ...account, sessionId: "visit-1" },
  );
  emit.mockClear();
  add.mockResolvedValueOnce([]);
  expect((await call("POST", { explainerId: "8", alsoFits })).status).toBe(404);
  expect(emit).not.toHaveBeenCalled();
  expect(
    (
      await call("POST", {
        explainerId: "7",
        alsoFits: { position: 4, chip: "3-8" },
      })
    ).status,
  ).toBe(400);
  expect((await call("POST", { explainerId: "7" })).status).toBe(400);
});
