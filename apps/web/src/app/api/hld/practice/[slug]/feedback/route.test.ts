import { practiceProblems, starterDesign } from "@interval/hld";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type {
  Actor,
  HldJudgements,
  JobQueue,
} from "../../../../../../server/ports";

// P6-W41 (CANVAS-6, §6.4, Q-P6-05): asking for the AI judge and coach on a practice
// design: checked and simulated here, queued once, dropped if it can't be queued.
const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
const can = vi.fn<(userId: string, capability: string) => Promise<boolean>>(
  () => Promise.resolve(true),
);
const request = vi.fn<HldJudgements["request"]>(() =>
  Promise.resolve({ id: "j1", created: true }),
);
const drop = vi.fn<HldJudgements["drop"]>(() => Promise.resolve());
const enqueue = vi.fn<JobQueue["enqueue"]>(() => Promise.resolve());
vi.mock("../../../../../../server/container", () => ({
  entitlements: () => ({ can }),
  sessionReader: () => ({ current }),
  hldJudgements: () => ({ request, drop }),
  jobQueue: () => ({ enqueue }),
}));
vi.mock("../../../../../../env", () => ({
  env: () => ({ BETTER_AUTH_URL: "http://localhost:3100" }),
}));

const ada: Actor = { userId: "u1", isGuest: false, betaGroup: "student" };
const slug = "url-shortener";

beforeEach(() => {
  current.mockResolvedValue(ada);
});
afterEach(() => {
  vi.clearAllMocks();
});

async function post(body: unknown, to = slug): Promise<Response> {
  const { POST } = await import("./route");
  return POST(
    new Request(`http://localhost:3100/api/hld/practice/${to}/feedback`, {
      method: "POST",
      headers: { origin: "http://localhost:3100" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    { params: Promise.resolve({ slug: to }) },
  );
}

test("a design is simulated here and its request queued once", async () => {
  const res = await post(starterDesign());
  expect(res.status).toBe(202);
  expect(await res.json()).toEqual({ id: "j1" });
  const [userId, asked, input, baselinePassed] = request.mock.calls[0] ?? [];
  expect([userId, asked, baselinePassed]).toEqual(["u1", slug, false]);
  expect(input?.rubric).toEqual(
    practiceProblems().find((p) => p.slug === slug)?.rubric,
  );
  expect(enqueue).toHaveBeenCalledWith(
    "judge_hld",
    { judgement_id: "j1" },
    { idempotencyKey: "hld-judge-j1" },
  );
  request.mockResolvedValueOnce({ id: "j1", created: false });
  expect((await post(starterDesign())).status).toBe(202);
  expect(enqueue).toHaveBeenCalledTimes(1);
});

test("a design that doesn't parse or fit the problem is refused, unasked", async () => {
  expect((await post("{nope")).status).toBe(400);
  expect((await post({ ...starterDesign(), nodes: [] })).status).toBe(400);
  const queue = {
    id: "q",
    kind: "queue",
    config: { partitions: 1, retentionHours: 1, zones: 1, regions: 1 },
    note: "",
  };
  const banned = {
    ...starterDesign(),
    nodes: [...starterDesign().nodes, queue],
  };
  expect((await post(banned)).status).toBe(400);
  expect((await post(starterDesign(), "no-such-problem")).status).toBe(404);
  expect(request).not.toHaveBeenCalled();
});

test("signed out, without the capability, or from elsewhere: refused", async () => {
  current.mockResolvedValueOnce(null);
  expect((await post(starterDesign())).status).toBe(401);
  can.mockResolvedValueOnce(false);
  expect((await post(starterDesign())).status).toBe(403);
  const { POST } = await import("./route");
  const res = await POST(
    new Request(`http://localhost:3100/api/hld/practice/${slug}/feedback`, {
      method: "POST",
      headers: { origin: "https://elsewhere.example" },
      body: JSON.stringify(starterDesign()),
    }),
    { params: Promise.resolve({ slug }) },
  );
  expect(res.status).toBe(403);
});

test("a request that can't be queued is dropped, so it can be asked again", async () => {
  enqueue.mockRejectedValueOnce(new Error("queue down"));
  await expect(post(starterDesign())).rejects.toThrow("queue down");
  expect(drop).toHaveBeenCalledWith("j1");
});
