import { afterEach, expect, test, vi } from "vitest";
import type {
  Actor,
  BattleResults,
  JobQueue,
} from "../../../../../server/ports";

// P5-W35 (Q-P5-14, Q-P5-22): the AI code review, requested once and queued.
const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
const requestReview = vi.fn<BattleResults["requestReview"]>();
const dropReview = vi.fn<BattleResults["dropReview"]>(() => Promise.resolve());
const enqueue = vi.fn<JobQueue["enqueue"]>(() => Promise.resolve());
vi.mock("../../../../../server/container", () => ({
  sessionReader: () => ({ current }),
  battleResults: () => ({ requestReview, dropReview }),
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

async function post(): Promise<number> {
  const { POST } = await import("./route");
  const res = await POST(
    new Request(`http://localhost:3100/api/battle/${MATCH}/review`, {
      method: "POST",
      headers: { origin: "http://localhost:3100" },
    }),
    { params: Promise.resolve({ id: MATCH }) },
  );
  return res.status;
}

test("a first request is queued; a repeat isn't; no code is refused", async () => {
  current.mockResolvedValue(ada);
  requestReview.mockResolvedValueOnce("requested");
  expect(await post()).toBe(202);
  expect(enqueue).toHaveBeenCalledWith(
    "review_code",
    { match_id: MATCH, user_id: "u1" },
    { idempotencyKey: `review-${MATCH}-u1` },
  );
  requestReview.mockResolvedValueOnce("exists");
  expect(await post()).toBe(202);
  // A pending request whose job was lost is queued again (the key keeps it once).
  requestReview.mockResolvedValueOnce("pending");
  expect(await post()).toBe(202);
  requestReview.mockResolvedValueOnce("no_code");
  expect(await post()).toBe(409);
  requestReview.mockResolvedValueOnce(null);
  expect(await post()).toBe(404);
  expect(enqueue).toHaveBeenCalledTimes(2);
});

test("a request that can't be queued is dropped, so it can be asked again", async () => {
  current.mockResolvedValue(ada);
  requestReview.mockResolvedValueOnce("requested");
  enqueue.mockRejectedValueOnce(new Error("queue down"));
  await expect(post()).rejects.toThrow("queue down");
  expect(dropReview).toHaveBeenCalledWith(MATCH, "u1");
});
