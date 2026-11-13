import { afterEach, expect, test, vi } from "vitest";
import type {
  Actor,
  BattleQuestions,
  JobQueue,
} from "../../../../../server/ports";

// P5-W33 (§6.2, Q-P5-13): asking the interviewer, and the answer queued for the worker.
const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
const ask = vi.fn<BattleQuestions["ask"]>();
const list = vi.fn<BattleQuestions["list"]>(() => Promise.resolve([]));
const fail = vi.fn<BattleQuestions["fail"]>(() => Promise.resolve());
const enqueue = vi.fn<JobQueue["enqueue"]>(() => Promise.resolve());
vi.mock("../../../../../server/container", () => ({
  sessionReader: () => ({ current }),
  battleQuestions: () => ({ ask, list, fail }),
  jobQueue: () => ({ enqueue }),
}));
vi.mock("../../../../../env", () => ({
  env: () => ({ BETTER_AUTH_URL: "http://localhost:3100" }),
}));

const MATCH = "6f1c2b8e-3d4a-4e5f-9a0b-1c2d3e4f5a6b";
const ada: Actor = { userId: "u1", isGuest: false, betaGroup: "student" };

afterEach(() => {
  vi.clearAllMocks();
});

async function post(
  body: unknown,
  { id = MATCH, origin = "http://localhost:3100" } = {},
): Promise<number> {
  const { POST } = await import("./route");
  const res = await POST(
    new Request(`http://localhost:3100/api/battle/${id}/questions`, {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
  return res.status;
}

test("a question is kept and its answer queued once", async () => {
  current.mockResolvedValue(ada);
  ask.mockResolvedValue({ id: "42" });
  expect(await post({ question: "  Can a value be null?  " })).toBe(202);
  expect(ask).toHaveBeenCalledWith(MATCH, "u1", "Can a value be null?");
  expect(enqueue).toHaveBeenCalledWith(
    "answer_interviewer",
    { question_id: 42 },
    { idempotencyKey: "interviewer-42" },
  );
});

test("not a player of an open AI battle, or past 10, is refused", async () => {
  current.mockResolvedValue(ada);
  ask.mockResolvedValueOnce(null);
  expect(await post({ question: "Q?" })).toBe(404);
  ask.mockResolvedValueOnce("limit");
  expect(await post({ question: "Q?" })).toBe(429);
  expect(enqueue).not.toHaveBeenCalled();
});

test("signed out, another site, or a bad body: nothing asked", async () => {
  current.mockResolvedValue(null);
  expect(await post({ question: "Q?" })).toBe(401);
  current.mockResolvedValue(ada);
  expect(
    await post({ question: "Q?" }, { origin: "https://evil.example" }),
  ).toBe(403);
  expect(await post({ question: "" })).toBe(400);
  expect(await post({ question: "x".repeat(501) })).toBe(400);
  expect(await post({ question: "Q?" }, { id: "nope" })).toBe(400);
  expect(ask).not.toHaveBeenCalled();
});

test("a question that can't be queued is shown unanswered, and the error thrown", async () => {
  current.mockResolvedValue(ada);
  ask.mockResolvedValue({ id: "43" });
  enqueue.mockRejectedValueOnce(new Error("queue down"));
  await expect(post({ question: "Q?" })).rejects.toThrow("queue down");
  expect(fail).toHaveBeenCalledWith("43");
});
