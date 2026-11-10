import { afterEach, expect, test, vi } from "vitest";
import type { Actor } from "../../../../server/ports";

// P4-W23-S01 (§5G, DB-5): starting, saving and finishing a queued explainer.
const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
const start = vi.fn();
const save = vi.fn();
const finish = vi.fn();
const remove = vi.fn();
const emit = vi.fn();
vi.mock("../../../../server/container", () => ({
  sessionReader: () => ({ current }),
  listening: () => ({ start, save, finish, remove }),
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
afterEach(() => {
  vi.clearAllMocks();
});
const call = async (
  method: "POST" | "DELETE",
  explainer: string,
  body?: unknown,
  headers: Record<string, string> = APP,
) => {
  const route = await import("./route");
  const request = new Request(`http://localhost:3100/api/listen/${explainer}`, {
    method,
    headers: { "content-type": "application/json", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const ctx = { params: Promise.resolve({ explainer }) };
  return method === "POST"
    ? route.POST(request, ctx)
    : route.DELETE(request, ctx);
};

test("a new listen counts once; a resume doesn't", async () => {
  current.mockResolvedValue(account);
  start.mockResolvedValueOnce({ conceptId: "3", new: true });
  expect((await call("POST", "7", { action: "start" })).status).toBe(204);
  expect(emit).toHaveBeenCalledWith(
    "explainer_started",
    { explainer_id: "7", concept_id: "3" },
    expect.objectContaining({ userId: "u1", source: "android" }),
  );
  start.mockResolvedValueOnce({ conceptId: "3", new: false });
  expect((await call("POST", "7", { action: "start" })).status).toBe(204);
  expect(emit).toHaveBeenCalledTimes(1);
  start.mockResolvedValueOnce(null);
  expect((await call("POST", "8", { action: "start" })).status).toBe(404);
});

test("finishing counts it; the position is saved without an event", async () => {
  current.mockResolvedValue(account);
  finish.mockResolvedValueOnce({ conceptId: "3", new: true });
  expect((await call("POST", "7", { action: "finish" })).status).toBe(204);
  expect(emit).toHaveBeenCalledWith(
    "explainer_finished",
    { explainer_id: "7", concept_id: "3" },
    expect.anything(),
  );
  save.mockResolvedValueOnce(true);
  expect(
    (await call("POST", "7", { action: "position", seconds: 41.5 })).status,
  ).toBe(204);
  expect(save).toHaveBeenCalledWith("u1", "7", 41.5);
  expect(emit).toHaveBeenCalledTimes(1);
  // LOAD-5: a retried finish isn't counted twice.
  finish.mockResolvedValueOnce({ conceptId: "3", new: false });
  expect((await call("POST", "7", { action: "finish" })).status).toBe(204);
  expect(emit).toHaveBeenCalledTimes(1);
});

test("removed from the queue, or not there", async () => {
  current.mockResolvedValue(account);
  remove.mockResolvedValueOnce(true);
  expect((await call("DELETE", "7")).status).toBe(204);
  remove.mockResolvedValueOnce(false);
  expect((await call("DELETE", "7")).status).toBe(404);
});

test("refused: no session, a guest, another site, a bad id or body", async () => {
  current.mockResolvedValue(null);
  expect((await call("POST", "7", { action: "start" })).status).toBe(401);
  current.mockResolvedValue({ ...account, isGuest: true });
  expect((await call("DELETE", "7")).status).toBe(401);
  current.mockResolvedValue(account);
  expect((await call("POST", "7", { action: "start" }, {})).status).toBe(403);
  expect((await call("POST", "x", { action: "start" })).status).toBe(400);
  expect(
    (await call("POST", "7", { action: "position", seconds: -1 })).status,
  ).toBe(400);
  expect((await call("POST", "7", { action: "skip" })).status).toBe(400);
  expect(start).not.toHaveBeenCalled();
  expect(save).not.toHaveBeenCalled();
});
