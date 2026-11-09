import type { Game, QuizResults } from "@interval/api-client";
import type { Capability } from "@interval/db";
import { points } from "@interval/scoring";
import { entitlements, events, leaderboards, quizzes } from "./container";
import type { EventContext } from "./events";
import type {
  EstimateResult,
  QuizAttempt,
  QuizFinish,
  QuizResult,
  Quizzes,
} from "./ports";

// The quiz flow behind Test 60s and the solo games (Q-P2-14, §6.3): the web's actions
// and the app's routes (P4-W21-S01) start, answer and finish through these, so each
// records the same events once. The server holds the clock and the key (Quizzes).

// A game's score: the daily's points, an estimation round's, a sprint's correct count.
function gameScore(
  done: QuizFinish,
): { game: "daily" | "sprint" | "estimation"; points: number } | null {
  if (done.daily !== null) return { game: "daily", points: done.daily.points };
  if (!done.sprint) return null;
  return done.estimation === null
    ? { game: "sprint", points: done.correct }
    : { game: "estimation", points: done.estimation.points };
}

// P3-W14-S01 (§6.7): a game on its board at every finish, not only the first: the
// store keeps one score per game, and a repeat mends a board a failed write left
// behind (LOAD-5).
async function scoreGame(
  userId: string,
  attemptId: string,
  done: QuizFinish,
): Promise<void> {
  const score = gameScore(done);
  if (score !== null)
    await leaderboards().record(userId, attemptId, score.points);
}

// The finish of a quiz, once: on the page, or when a start closes one left open (owner,
// 2026-10-28, Q-P2-28), so the metrics count both.
function recordFinish(
  attemptId: string,
  done: QuizFinish,
  context: EventContext,
): void {
  const { checkpoint } = done;
  const counts = { answered: done.answered, correct: done.correct };
  const score = gameScore(done);
  if (score !== null) {
    events().emit(
      "game_finished",
      { attempt_id: attemptId, ...counts, ...score },
      context,
    );
    // P3-W18-S03 (owner, 2026-11-05): each miss it sends back to reading.
    for (const m of done.missed)
      events().emit(
        "concept_missed",
        { game: score.game, item_id: m.itemId, moment_id: m.momentId },
        context,
      );
  } else if (checkpoint === null)
    events().emit(
      "quiz_finished",
      { attempt_id: attemptId, ...counts },
      context,
    );
  else if (checkpoint.at.kind === "path")
    events().emit(
      "checkpoint_finished",
      {
        attempt_id: attemptId,
        path_id: checkpoint.at.pathId,
        section_id: checkpoint.at.sectionId,
        ...counts,
        passed: checkpoint.passed,
      },
      context,
    );
  else
    events().emit(
      "book_checkpoint_finished",
      {
        attempt_id: attemptId,
        book_id: checkpoint.at.bookId,
        chapter_id: checkpoint.at.chapterId,
        ...counts,
        passed: checkpoint.passed,
      },
      context,
    );
}

// Before a start: the user's quizzes left open are closed, and their finishes recorded.
export async function closeLeftOpen(
  userId: string,
  context: EventContext,
): Promise<void> {
  for (const closed of await quizzes().closeStale(userId)) {
    recordFinish(closed.attemptId, closed, context);
    await scoreGame(userId, closed.attemptId, closed);
  }
}

// Test 60s on a section or an article (P2-W9-S01); null with no live question.
export async function startTest(
  context: EventContext,
  itemId: string,
  momentId: string | null,
): Promise<{ attemptId: string } | null> {
  await closeLeftOpen(context.userId, context);
  const started = await quizzes().start(context.userId, itemId, momentId);
  if (started === null) return null;
  if (started.firstTime)
    events().emit(
      "quiz_started",
      {
        attempt_id: started.attemptId,
        kind: "test",
        item_id: itemId,
        moment_id: momentId,
      },
      context,
    );
  return { attemptId: started.attemptId };
}

// P3-W13-S02 (§6.3): a solo game from Play, for anyone whose plan has it (OPS-3),
// guests included (ADR-0029): the sprint, estimation (P3-W13-S04), or today's daily
// challenge (P3-W13-S05), whose start after it's played gives the played attempt.
export const GAME_STARTS = {
  sprint: { capability: "play.sprint", start: "startSprint" },
  estimation: { capability: "play.estimation", start: "startEstimation" },
  daily: { capability: "play.daily", start: "startDaily" },
} as const satisfies Record<
  Game,
  { capability: Capability; start: keyof Quizzes }
>;

// "none": nothing to play, every question asked this week (Q-P3-04) or no daily set.
export async function startGame(
  context: EventContext,
  game: Game,
): Promise<{ attemptId: string } | "forbidden" | "none"> {
  const { userId } = context;
  const { capability, start } = GAME_STARTS[game];
  if (!(await entitlements().can(userId, capability))) return "forbidden";
  await closeLeftOpen(userId, context);
  let started = await quizzes()[start](userId);
  // A game whose clock ran out moments ago (still in its grace, so not closed
  // above): finished and recorded here, so Start starts a fresh one.
  if (started !== null && started.endsAt.getTime() <= Date.now()) {
    const done = await quizzes().finish(userId, started.attemptId);
    if (done?.firstTime === true)
      recordFinish(started.attemptId, done, context);
    if (done !== null) await scoreGame(userId, started.attemptId, done);
    started = await quizzes()[start](userId);
  }
  if (started === null) return "none";
  if (started.firstTime)
    events().emit(
      "game_started",
      { attempt_id: started.attemptId, game },
      context,
    );
  return { attemptId: started.attemptId };
}

// LOAD-5: the attempt and question are the answer's idempotency key; a resubmission
// gets the stored result and records nothing. Null: not this attempt's open question.
export async function answerChoice(
  context: EventContext,
  attemptId: string,
  questionId: string,
  chosen: number,
): Promise<QuizResult | "late" | null> {
  const got = await quizzes().answer(
    context.userId,
    attemptId,
    questionId,
    chosen,
  );
  if (got !== null && got !== "late" && got.firstTime)
    events().emit(
      "quiz_answered",
      {
        attempt_id: attemptId,
        question_id: questionId,
        result: got.correct ? "right" : "wrong",
        ms: got.answeredAt.getTime() - got.servedAt.getTime(),
      },
      context,
    );
  return got;
}

// P3-W13-S04 (C-27): an estimate, scored by the server.
export async function answerEstimate(
  context: EventContext,
  attemptId: string,
  questionId: string,
  guess: number,
): Promise<EstimateResult | "late" | null> {
  const got = await quizzes().answerEstimate(
    context.userId,
    attemptId,
    questionId,
    guess,
  );
  if (got !== null && got !== "late" && got.firstTime)
    events().emit(
      "estimate_answered",
      {
        attempt_id: attemptId,
        question_id: questionId,
        points: points(got.score),
        ms: got.answeredAt.getTime() - got.servedAt.getTime(),
      },
      context,
    );
  return got;
}

// The finish, recorded once and scored every time (see scoreGame).
export async function finishAttempt(
  context: EventContext,
  attemptId: string,
): Promise<QuizFinish | null> {
  const done = await quizzes().finish(context.userId, attemptId);
  if (done === null) return null;
  if (done.firstTime) recordFinish(attemptId, done, context);
  await scoreGame(context.userId, attemptId, done);
  return done;
}

// What an attempt is, for the app's quiz screens (P4-W21-S01).
export function quizKind(
  attempt: QuizAttempt,
): "test" | "sprint" | "estimation" | "daily" | "review" | "checkpoint" {
  if (attempt.daily !== null) return "daily";
  if (attempt.estimation !== null) return "estimation";
  if (attempt.sprint) return "sprint";
  if (attempt.review) return "review";
  if (attempt.checkpoint !== null) return "checkpoint";
  return "test";
}

// The app's results (P4-W21-S01): the finish route's answer and the results route's.
export function quizResults(attempt: QuizAttempt): QuizResults {
  const kind = quizKind(attempt);
  return {
    kind,
    title: attempt.title,
    answered: attempt.answered,
    correct: attempt.correct,
    points:
      attempt.daily?.points ??
      attempt.estimation?.points ??
      (kind === "sprint" ? attempt.correct : null),
    daily:
      attempt.daily === null
        ? null
        : { shareId: attempt.daily.shareId, streak: attempt.daily.streak },
    missed: attempt.missed.map((m) => ({
      itemId: m.itemId,
      momentId: m.momentId,
      sectionTitle: m.sectionTitle,
    })),
  };
}
