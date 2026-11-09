import {
  type AnswerBody,
  AnswerResult,
  type Game,
  PlayResponse,
  QuizResults,
  QuizStarted,
  QuizView,
} from "@interval/api-client";
import { api } from "./api";

// P4-W21-S01 (§6.3, Q-P2-14): Play, the games, the daily and Test 60s, from the site's
// API. The server holds the clock and the key; each answer comes back checked.
type Got<T> =
  | { status: "ok"; value: T }
  | { status: "late" | "none" | "forbidden" | "failed" };

// The shared schemas' safeParse, without the app importing zod itself.
type Schema<T> = {
  safeParse: (
    raw: unknown,
  ) =>
    { success: true; data: T } | { success: false; error: { message: string } };
};

async function read<T>(
  response: Response,
  schema: Schema<T>,
  what: string,
): Promise<Got<T>> {
  if (response.status === 409) return { status: "late" };
  if (response.status === 404) return { status: "none" };
  if (response.status === 403) return { status: "forbidden" };
  if (!response.ok) {
    console.warn(`${what}: not read`, response.status);
    return { status: "failed" };
  }
  const parsed = schema.safeParse(await response.json());
  if (!parsed.success) {
    console.warn(`${what}: not one`, parsed.error.message);
    return { status: "failed" };
  }
  return { status: "ok", value: parsed.data };
}

export const readPlay = async () =>
  read(await api("/api/play", { method: "GET" }), PlayResponse, "play");

export const startQuiz = async (
  body: { game: Game } | { itemId: string; momentId?: string },
) =>
  read(await api("/api/quiz", { method: "POST", body }), QuizStarted, "quiz");

export const readQuiz = async (attemptId: string) =>
  read(
    await api(`/api/quiz/${attemptId}`, { method: "GET" }),
    QuizView,
    "quiz",
  );

export const answerQuiz = async (attemptId: string, body: AnswerBody) =>
  read(
    await api(`/api/quiz/${attemptId}/answer`, { method: "POST", body }),
    AnswerResult,
    "answer",
  );

// Read only: a running attempt is "late" (409), and goes back to its quiz.
export const readResults = async (attemptId: string) =>
  read(
    await api(`/api/quiz/${attemptId}/results`, { method: "GET" }),
    QuizResults,
    "results",
  );

export const finishQuiz = async (attemptId: string) =>
  read(
    await api(`/api/quiz/${attemptId}/finish`, { method: "POST" }),
    QuizResults,
    "results",
  );
