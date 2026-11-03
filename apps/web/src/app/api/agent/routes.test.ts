import { afterEach, expect, test, vi } from "vitest";
import type {
  Actor,
  AgentHook,
  Challenges,
  RateLimits,
} from "../../../server/ports";
import { POST as finishedPost } from "./finished/route";
import { POST as startedPost } from "./started/route";

// P3-W17-S04 (§7, C-09, LOAD-5, Q-P3-28): the agent hook takes a device token and an
// idempotency key, nothing else; "finished" saves the place.
const actor: Actor = { userId: "u1", isGuest: false, betaGroup: "developer" };
const deviceFor = vi.fn<AgentHook["deviceFor"]>(() =>
  Promise.resolve({ deviceId: "d1", actor }),
);
const start = vi.fn<AgentHook["start"]>(() => Promise.resolve("started"));
const finish = vi.fn<AgentHook["finish"]>(() =>
  Promise.resolve({ status: "finished", elapsedMs: 240_000 }),
);
const allow = vi.fn<RateLimits["allow"]>(() => Promise.resolve(true));
const lastPage = vi.fn<Challenges["lastPage"]>(() =>
  Promise.resolve("/read/42"),
);
const noteAgentFinished = vi.fn<Challenges["noteAgentFinished"]>(() =>
  Promise.resolve(),
);
const emit = vi.fn();
vi.mock("../../../server/container", () => ({
  agentHook: () => ({ deviceFor, start, finish }),
  rateLimits: () => ({ allow }),
  challenges: () => ({ lastPage, noteAgentFinished }),
  events: () => ({ emit }),
}));

afterEach(() => {
  vi.clearAllMocks();
});

const TOKEN = `ivd_${"a".repeat(43)}`;
const call = async (
  route: "started" | "finished",
  body: unknown,
  auth: string | null = `Bearer ${TOKEN}`,
) => {
  const POST = route === "started" ? startedPost : finishedPost;
  return POST(
    new Request(`http://localhost:3100/api/agent/${route}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(auth === null ? {} : { authorization: auth }),
      },
      body: JSON.stringify(body),
    }),
  );
};

test("started: the device's task begins, once per key, and an event with nothing in it", async () => {
  const response = await call("started", { idempotency_key: "key-12345" });
  expect(await response.json()).toEqual({ status: "started" });
  expect(deviceFor).toHaveBeenCalledWith(TOKEN, expect.any(Date));
  expect(start).toHaveBeenCalledWith("d1", "key-12345", expect.any(Date));
  expect(emit).toHaveBeenCalledExactlyOnceWith(
    "agent_task_started",
    {},
    { ...actor, sessionId: null },
  );
  start.mockResolvedValueOnce("repeat");
  expect(
    await (await call("started", { idempotency_key: "key-12345" })).json(),
  ).toEqual({ status: "repeat" });
  expect(emit).toHaveBeenCalledOnce();
});

test.each([
  [{ idempotency_key: "key-12345", prompt: "refactor auth" }],
  [{ idempotency_key: "key-12345", code: "rm -rf /" }],
  [{ idempotency_key: "short" }],
  [{}],
  ["started"],
])(
  "anything but a key is refused before the device is looked up (%j)",
  async (body) => {
    for (const route of ["started", "finished"] as const) {
      const response = await call(route, body);
      expect(response.status).toBe(400);
    }
    expect(deviceFor).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
  },
);

test("no token, a malformed one, or one no device has: 401", async () => {
  expect(
    (await call("started", { idempotency_key: "key-12345" }, null)).status,
  ).toBe(401);
  expect(
    (await call("started", { idempotency_key: "key-12345" }, "Bearer nope"))
      .status,
  ).toBe(401);
  deviceFor.mockResolvedValueOnce(null);
  expect(
    (await call("finished", { idempotency_key: "key-12345" })).status,
  ).toBe(401);
  expect(finish).not.toHaveBeenCalled();
});

test("finished saves the page last open, tells the open tab, and says how long it ran", async () => {
  const response = await call("finished", { idempotency_key: "key-67890" });
  expect(await response.json()).toEqual({ status: "finished" });
  // The place goes with the finish, in one step.
  expect(finish).toHaveBeenCalledWith(
    "d1",
    "key-67890",
    expect.any(Date),
    "/read/42",
  );
  expect(noteAgentFinished).toHaveBeenCalledWith("u1");
  expect(emit).toHaveBeenCalledExactlyOnceWith(
    "agent_task_finished",
    { elapsed_ms: 240_000, place_saved: true },
    { ...actor, sessionId: null },
  );
});

test("finished with no page open saves nothing; a repeat or no task does nothing", async () => {
  lastPage.mockResolvedValueOnce(null);
  await call("finished", { idempotency_key: "key-67890" });
  expect(finish).toHaveBeenCalledWith(
    "d1",
    "key-67890",
    expect.any(Date),
    null,
  );
  expect(noteAgentFinished).not.toHaveBeenCalled();
  expect(emit.mock.calls[0]?.[1]).toEqual({
    elapsed_ms: 240_000,
    place_saved: false,
  });
  emit.mockClear();
  finish.mockResolvedValueOnce({ status: "repeat" });
  expect(
    await (await call("finished", { idempotency_key: "key-67890" })).json(),
  ).toEqual({
    status: "repeat",
  });
  finish.mockResolvedValueOnce({ status: "none" });
  expect(
    await (await call("finished", { idempotency_key: "key-00000" })).json(),
  ).toEqual({
    status: "none",
  });
  expect(emit).not.toHaveBeenCalled();
});

test("too many calls a minute from one device: 429; a body too big: 413", async () => {
  allow.mockResolvedValueOnce(false);
  const limited = await call("started", { idempotency_key: "key-12345" });
  expect(limited.status).toBe(429);
  expect(allow).toHaveBeenCalledWith("agent:d1", 30, 60);
  expect(start).not.toHaveBeenCalled();
  const { POST } = { POST: startedPost };
  const big = await POST(
    new Request("http://localhost:3100/api/agent/started", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": "5000",
        authorization: `Bearer ${TOKEN}`,
      },
      body: JSON.stringify({ idempotency_key: "k".repeat(4000) }),
    }),
  );
  expect(big.status).toBe(413);
});

test("a lost tab note is logged; the finish and its place stand", async () => {
  const out = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  noteAgentFinished.mockRejectedValueOnce(new Error("valkey down"));
  const response = await call("finished", { idempotency_key: "key-67890" });
  expect(await response.json()).toEqual({ status: "finished" });
  expect(out.mock.calls.map(([c]) => String(c)).join("")).toContain(
    "agent: finished note not set",
  );
  out.mockRestore();
});
