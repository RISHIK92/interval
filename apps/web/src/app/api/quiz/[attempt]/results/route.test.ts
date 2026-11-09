import { QuizResults } from "@interval/api-client";
import { afterEach, expect, test, vi } from "vitest";
import type { Actor, QuizAttempt } from "../../../../../server/ports";

// P4-W21-S01: results are read, never made: a running attempt is 409.
const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
const attempt = vi.fn<() => Promise<QuizAttempt | null>>();
vi.mock("../../../../../server/container", () => ({
  sessionReader: () => ({ current }),
  quizzes: () => ({ attempt }),
}));
vi.mock("../../../../../env", () => ({
  env: () => ({
    BETTER_AUTH_URL: "http://localhost:3100",
    NODE_ENV: "production",
  }),
}));

const account: Actor = { userId: "u1", isGuest: false, betaGroup: "student" };
const sprint = {
  review: false,
  sprint: true,
  estimation: null,
  daily: null,
  checkpoint: null,
  title: "60-second sprint",
  answered: 4,
  correct: 3,
  missed: [],
  finishedAt: new Date(),
} as unknown as QuizAttempt;
afterEach(() => {
  vi.clearAllMocks();
});
const get = async (
  headers: Record<string, string> = { "expo-origin": "interval://" },
) => {
  const { GET } = await import("./route");
  return GET(
    new Request("http://localhost:3100/api/quiz/40/results", { headers }),
    {
      params: Promise.resolve({ attempt: "40" }),
    },
  );
};

test("a finished sprint's results; a running one isn't finished by asking", async () => {
  current.mockResolvedValue(account);
  attempt.mockResolvedValueOnce(sprint);
  expect(QuizResults.parse(await (await get()).json())).toMatchObject({
    kind: "sprint",
    points: 3,
  });
  attempt.mockResolvedValueOnce({ ...sprint, finishedAt: null });
  expect((await get()).status).toBe(409);
  attempt.mockResolvedValueOnce(null);
  expect((await get()).status).toBe(404);
  expect((await get({})).status).toBe(403);
});
