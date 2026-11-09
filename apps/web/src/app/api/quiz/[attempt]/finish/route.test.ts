import { QuizResults } from "@interval/api-client";
import { afterEach, expect, test, vi } from "vitest";
import type { Actor, QuizAttempt } from "../../../../../server/ports";

// P4-W21-S01 (§6.3): the finish, recorded as the web's, and the results.
const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
const finishAttempt = vi.fn();
const attempt = vi.fn<() => Promise<QuizAttempt | null>>();
vi.mock("../../../../../server/container", () => ({
  sessionReader: () => ({ current }),
  quizzes: () => ({ attempt }),
}));
vi.mock("../../../../../server/quiz-flow", async (actual) => ({
  ...(await actual<typeof import("../../../../../server/quiz-flow")>()),
  finishAttempt,
}));
vi.mock("../../../../../env", () => ({
  env: () => ({
    BETTER_AUTH_URL: "http://localhost:3100",
    NODE_ENV: "production",
  }),
}));

const account: Actor = { userId: "u1", isGuest: false, betaGroup: "student" };
const APP = { "expo-origin": "interval://", "interval-platform": "ios" };
const daily = {
  review: false,
  sprint: true,
  estimation: null,
  daily: {
    points: 350,
    answers: [],
    streak: { days: 4, freezes: 0 },
    shareId: "0b6f1c2e-0000-4000-8000-000000000001",
  },
  checkpoint: null,
  title: "Today's challenge",
  answered: 5,
  correct: 3,
  missed: [
    { itemId: "5", momentId: "9", sectionTitle: "Timeouts", frameable: true },
  ],
} as unknown as QuizAttempt;
afterEach(() => {
  vi.clearAllMocks();
});
const post = async (headers: Record<string, string> = APP) => {
  const { POST } = await import("./route");
  return POST(
    new Request("http://localhost:3100/api/quiz/40/finish", {
      method: "POST",
      headers,
    }),
    { params: Promise.resolve({ attempt: "40" }) },
  );
};

test("the daily's results: points, its share and streak, sections to read again", async () => {
  current.mockResolvedValue(account);
  finishAttempt.mockResolvedValue({ firstTime: true });
  attempt.mockResolvedValue(daily);
  expect(QuizResults.parse(await (await post()).json())).toEqual({
    kind: "daily",
    title: "Today's challenge",
    answered: 5,
    correct: 3,
    points: 350,
    daily: {
      shareId: "0b6f1c2e-0000-4000-8000-000000000001",
      streak: { days: 4, freezes: 0 },
    },
    missed: [{ itemId: "5", momentId: "9", sectionTitle: "Timeouts" }],
  });
  expect(finishAttempt).toHaveBeenCalledWith(
    expect.objectContaining({ source: "ios" }),
    "40",
  );
});

test("a sprint scores its right answers; Test 60s has no points", async () => {
  current.mockResolvedValue(account);
  finishAttempt.mockResolvedValue({ firstTime: false });
  attempt.mockResolvedValueOnce({ ...daily, daily: null });
  expect(QuizResults.parse(await (await post()).json()).points).toBe(3);
  attempt.mockResolvedValueOnce({ ...daily, daily: null, sprint: false });
  const test60 = QuizResults.parse(await (await post()).json());
  expect(test60).toMatchObject({ kind: "test", points: null, daily: null });
});

test("not theirs, no session or another site: refused", async () => {
  current.mockResolvedValue(account);
  finishAttempt.mockResolvedValue(null);
  expect((await post()).status).toBe(404);
  expect((await post({})).status).toBe(403);
  current.mockResolvedValue(null);
  expect((await post()).status).toBe(401);
});
