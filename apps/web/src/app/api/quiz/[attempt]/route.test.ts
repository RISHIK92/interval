import { QuizView } from "@interval/api-client";
import { afterEach, expect, test, vi } from "vitest";
import type {
  Actor,
  QuizAttempt,
  QuizQuestion,
} from "../../../../server/ports";

// P4-W21-S01 (Q-P2-14): the attempt and its open question, never the key.
const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
const attempt = vi.fn<() => Promise<QuizAttempt | null>>();
const next = vi.fn<() => Promise<QuizQuestion | "over" | null>>();
vi.mock("../../../../server/container", () => ({
  sessionReader: () => ({ current }),
  quizzes: () => ({ attempt, next }),
}));
vi.mock("../../../../env", () => ({
  env: () => ({
    BETTER_AUTH_URL: "http://localhost:3100",
    NODE_ENV: "production",
  }),
}));

const account: Actor = { userId: "u1", isGuest: false, betaGroup: "student" };
const APP = { "expo-origin": "interval://" };
const sprint = {
  review: false,
  sprint: true,
  estimation: null,
  daily: null,
  title: "60-second sprint",
  secondsLeft: 42,
  finishedAt: null,
  checkpoint: null,
} as unknown as QuizAttempt;
afterEach(() => {
  vi.clearAllMocks();
});
const get = async (id = "40", headers: Record<string, string> = APP) => {
  const { GET } = await import("./route");
  return GET(new Request(`http://localhost:3100/api/quiz/${id}`, { headers }), {
    params: Promise.resolve({ attempt: id }),
  });
};

test("a sprint's open question: its options, no key, the server's seconds", async () => {
  current.mockResolvedValue(account);
  attempt.mockResolvedValue(sprint);
  next.mockResolvedValue({
    kind: "choice",
    questionId: "7",
    stem: "What elects a leader?",
    options: ["Raft", "TCP"],
    servedAt: new Date(),
    aiDrafted: true,
    correctOption: 0,
  } as QuizQuestion);
  const raw: unknown = await (await get()).json();
  expect(QuizView.parse(raw)).toEqual({
    title: "60-second sprint",
    kind: "sprint",
    secondsLeft: 42,
    question: {
      kind: "choice",
      questionId: "7",
      stem: "What elects a leader?",
      aiDrafted: true,
      options: ["Raft", "TCP"],
    },
  });
  expect(JSON.stringify(raw)).not.toContain("correct");
  expect(next).toHaveBeenCalledWith("u1", "40");
});

test("over, or finished: no question served", async () => {
  current.mockResolvedValue(account);
  attempt.mockResolvedValue({ ...sprint, finishedAt: new Date() });
  expect(QuizView.parse(await (await get()).json()).question).toBeNull();
  expect(next).not.toHaveBeenCalled();
});

test("refused: no session, another site, a bad or someone else's attempt", async () => {
  current.mockResolvedValue(null);
  expect((await get()).status).toBe(401);
  current.mockResolvedValue(account);
  expect((await get("40", {})).status).toBe(403);
  expect((await get("x")).status).toBe(400);
  attempt.mockResolvedValue(null);
  expect((await get()).status).toBe(404);
});
