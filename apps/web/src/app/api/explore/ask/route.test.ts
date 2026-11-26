import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Actor, Asks, JobQueue } from "../../../../server/ports";

// ADR-0046: asking from Explore: the capability, a valid body, today's limits, then
// stored and queued once.
const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
const can = vi.fn<(userId: string, capability: string) => Promise<boolean>>(
  () => Promise.resolve(true),
);
const limit = vi.fn<(userId: string, capability: string) => Promise<number>>(
  (_userId, capability) =>
    Promise.resolve(capability === "explore.ask.daily" ? 20 : 50),
);
const submit = vi.fn<Asks["submit"]>(() =>
  Promise.resolve({
    id: "11111111-1111-4111-8111-111111111111",
    created: true,
  }),
);
const askedSince = vi.fn<Asks["askedSince"]>(() => Promise.resolve(0));
const spentToday = vi.fn<Asks["spentToday"]>(() =>
  Promise.resolve({ userUsd: 0, globalUsd: 0, globalCapCents: 30 }),
);
const enqueue = vi.fn<JobQueue["enqueue"]>(() => Promise.resolve());
const emit = vi.fn();
vi.mock("../../../../server/container", () => ({
  entitlements: () => ({ can, limit }),
  sessionReader: () => ({ current }),
  asks: () => ({
    submit,
    askedSince,
    spentToday,
    drop: vi.fn(),
    existing: () => Promise.resolve(null),
  }),
  jobQueue: () => ({ enqueue }),
  events: () => ({ emit }),
}));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined }),
}));
vi.mock("../../../../env", () => ({
  env: () => ({ BETTER_AUTH_URL: "http://localhost:3100" }),
}));

const ada: Actor = { userId: "u1", isGuest: false, betaGroup: null };
const body = {
  text: "When should I shard?",
  chip: null,
  idempotencyKey: "k1",
  followUpOf: null,
};

beforeEach(() => {
  current.mockResolvedValue(ada);
});
afterEach(() => {
  vi.clearAllMocks();
});

async function post(
  payload: unknown,
  origin = "http://localhost:3100",
): Promise<Response> {
  const { POST } = await import("./route");
  return POST(
    new Request("http://localhost:3100/api/explore/ask", {
      method: "POST",
      headers: { origin },
      body: typeof payload === "string" ? payload : JSON.stringify(payload),
    }),
  );
}

test("a question is stored and queued", async () => {
  const res = await post(body);
  expect(res.status).toBe(202);
  expect(await res.json()).toEqual({
    id: "11111111-1111-4111-8111-111111111111",
  });
  expect(submit).toHaveBeenCalledWith("u1", body);
  expect(enqueue).toHaveBeenCalledWith(
    "ask",
    { question_id: "11111111-1111-4111-8111-111111111111" },
    { idempotencyKey: "ask-11111111-1111-4111-8111-111111111111" },
  );
});

test("a plan without explore.ask, a guest, or another origin can't ask", async () => {
  can.mockResolvedValueOnce(false);
  expect((await post(body)).status).toBe(403);
  current.mockResolvedValueOnce({ ...ada, isGuest: true });
  expect((await post(body)).status).toBe(403);
  expect((await post(body, "https://elsewhere.example")).status).toBe(403);
  current.mockResolvedValueOnce(null);
  expect((await post(body)).status).toBe(401);
  expect(submit).not.toHaveBeenCalled();
});

test("a question over 300 characters, empty, or with an unknown chip is refused", async () => {
  expect((await post({ ...body, text: "x".repeat(301) })).status).toBe(400);
  expect((await post({ ...body, text: "   " })).status).toBe(400);
  expect((await post({ ...body, chip: "poem" })).status).toBe(400);
  expect((await post("{nope")).status).toBe(400);
  expect(submit).not.toHaveBeenCalled();
});

test("today's limit refuses with its reason, and nothing is queued", async () => {
  askedSince.mockResolvedValueOnce(20);
  const res = await post(body);
  expect(res.status).toBe(429);
  expect(await res.json()).toEqual({ refused: "daily_limit" });
  expect(enqueue).not.toHaveBeenCalled();
});

test("a thread past its follow-ups is refused", async () => {
  submit.mockResolvedValueOnce("thread_full");
  const res = await post({
    ...body,
    followUpOf: "22222222-2222-4222-8222-222222222222",
  });
  expect(res.status).toBe(409);
  submit.mockResolvedValueOnce("no_thread");
  expect(
    (
      await post({
        ...body,
        followUpOf: "22222222-2222-4222-8222-222222222222",
      })
    ).status,
  ).toBe(404);
});
