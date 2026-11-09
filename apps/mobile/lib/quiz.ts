import {
  type AnswerBody,
  AnswerResult,
  type Game,
  PlayResponse,
  QuizResults,
  QuizStarted,
  QuizView,
} from "@interval/api-client";
import { api, got } from "./api";

// P4-W21-S01 (§6.3, Q-P2-14): Play, the games, the daily and Test 60s, from the site's
// API. The server holds the clock and the key; each answer comes back checked.
export const readPlay = async () =>
  got(await api("/api/play", { method: "GET" }), PlayResponse, "play");

export const startQuiz = async (
  body:
    | { game: Game }
    | { itemId: string; momentId?: string }
    // P4-W21-S03: a path section's checkpoint.
    | { sectionId: string }
    // P4-W21-S04: a book chapter's checkpoint.
    | { chapterId: string },
) => got(await api("/api/quiz", { method: "POST", body }), QuizStarted, "quiz");

export const readQuiz = async (attemptId: string) =>
  got(await api(`/api/quiz/${attemptId}`, { method: "GET" }), QuizView, "quiz");

export const answerQuiz = async (attemptId: string, body: AnswerBody) =>
  got(
    await api(`/api/quiz/${attemptId}/answer`, { method: "POST", body }),
    AnswerResult,
    "answer",
  );

// Read only: a running attempt is a 409 ("conflict"), and goes back to its quiz.
export const readResults = async (attemptId: string) =>
  got(
    await api(`/api/quiz/${attemptId}/results`, { method: "GET" }),
    QuizResults,
    "results",
  );

export const finishQuiz = async (attemptId: string) =>
  got(
    await api(`/api/quiz/${attemptId}/finish`, { method: "POST" }),
    QuizResults,
    "results",
  );
