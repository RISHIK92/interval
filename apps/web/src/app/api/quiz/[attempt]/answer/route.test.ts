import { AnswerResult } from "@interval/api-client";
import { afterEach, expect, test, vi } from "vitest";
import type { Actor, QuizFeedback } from "../../../../../server/ports";

// P4-W21-S01 (Q-P2-14, C-27): an answer checked by the server, as the web's.
const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
const answerChoice = vi.fn();
const answerEstimate = vi.fn();
const answered = vi.fn<() => Promise<QuizFeedback | null>>();
vi.mock("../../../../../server/container", () => ({
  sessionReader: () => ({ current }),
  quizzes: () => ({ answered }),
}));
vi.mock("../../../../../server/quiz-flow", () => ({
  answerChoice,
  answerEstimate,
}));
vi.mock("../../../../../env", () => ({
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
const post = async (body: unknown, headers: Record<string, string> = APP) => {
  const { POST } = await import("./route");
  return POST(
    new Request("http://localhost:3100/api/quiz/40/answer", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ attempt: "40" }) },
  );
};

test("a choice: right or wrong and the right option, from android", async () => {
  current.mockResolvedValue(account);
  answerChoice.mockResolvedValue({ correct: false, correctOption: 2 });
  const body = AnswerResult.parse(
    await (await post({ questionId: "7", chosen: 1 })).json(),
  );
  expect(body).toEqual({ kind: "choice", correct: false, correctOption: 2 });
  expect(answerChoice).toHaveBeenCalledWith(
    expect.objectContaining({ source: "android", sessionId: null }),
    "40",
    "7",
    1,
  );
});

test("an estimate: the answer, its score and its source to read", async () => {
  current.mockResolvedValue(account);
  answerEstimate.mockResolvedValue({ answer: 300, unit: "ms", score: 0.6 });
  answered.mockResolvedValue({
    kind: "estimate",
    flagged: false,
    source: {
      kind: "section",
      itemId: "5",
      momentId: "9",
      sectionTitle: "Timeouts",
      frameable: true,
    },
  } as QuizFeedback);
  const body = AnswerResult.parse(
    await (await post({ questionId: "8", guess: 250 })).json(),
  );
  expect(body).toEqual({
    kind: "estimate",
    answer: 300,
    unit: "ms",
    score: 0.6,
    source: {
      kind: "section",
      itemId: "5",
      momentId: "9",
      sectionTitle: "Timeouts",
    },
  });
});

test("late, not this attempt's question, or refused", async () => {
  current.mockResolvedValue(account);
  answerChoice.mockResolvedValueOnce("late");
  expect((await post({ questionId: "7", chosen: 0 })).status).toBe(409);
  answerChoice.mockResolvedValueOnce(null);
  expect((await post({ questionId: "7", chosen: 0 })).status).toBe(404);
  expect((await post({ questionId: "7", chosen: 4 })).status).toBe(400);
  expect((await post({ questionId: "7", guess: -1 })).status).toBe(400);
  expect((await post({ questionId: "x", chosen: 0 })).status).toBe(400);
  expect((await post({ questionId: "7", chosen: 0 }, {})).status).toBe(403);
  current.mockResolvedValue(null);
  expect((await post({ questionId: "7", chosen: 0 })).status).toBe(401);
});

test("an estimate from a quoted page keeps its citation (AI-3); late is 409", async () => {
  current.mockResolvedValue(account);
  answerEstimate.mockResolvedValueOnce({ answer: 8, unit: "GB", score: 1 });
  const page = {
    kind: "page" as const,
    url: "https://docs.dev/limits",
    title: "Limits",
    citation: "Each node holds 8 GB.",
  };
  answered.mockResolvedValueOnce({
    kind: "estimate",
    flagged: false,
    source: page,
  } as QuizFeedback);
  const body = AnswerResult.parse(
    await (await post({ questionId: "8", guess: 8 })).json(),
  );
  expect(body).toMatchObject({ kind: "estimate", source: page });
  answerEstimate.mockResolvedValueOnce("late");
  expect((await post({ questionId: "8", guess: 8 })).status).toBe(409);
});
