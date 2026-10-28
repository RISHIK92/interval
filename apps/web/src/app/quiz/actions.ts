"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { CHIPS } from "../../server/chips";
import { events, quizzes, sessionReader } from "../../server/container";
import { BIGINT_ID, checkpointHome, type QuizFinish } from "../../server/ports";
import { visitId } from "../../server/visits";
import { sameSitePath, textField } from "../form";
import { FLAG_REASON_KEYS } from "./flagReasons";

// Test 60s (Q-P2-14, Q-P2-20, P2-W9-S01): the server holds the sprint's clock and
// checks each answer; these validate the form and record what happened once.
// The feed's chip rides along so the quiz returns to the same feed (and the reader).
const Start = z.object({
  itemId: z.string().regex(BIGINT_ID),
  momentId: z.string().regex(BIGINT_ID).optional(),
  chip: z.enum(CHIPS),
});
// LOAD-5: the attempt and question are the answer's idempotency key.
const Answer = z.object({
  attemptId: z.string().regex(BIGINT_ID),
  questionId: z.string().regex(BIGINT_ID),
  chosen: z.coerce.number().int().min(0).max(3),
  chip: z.enum(CHIPS),
});
// Close leaves for where the quiz started (the feed, the Library for a review, the
// path for a checkpoint); otherwise the results.
const Finish = z.object({
  attemptId: z.string().regex(BIGINT_ID),
  chip: z.enum(CHIPS),
  leave: z.enum(["feed", "library", "path"]).optional(),
});

async function signedIn() {
  const actor = await sessionReader().current(await headers());
  if (actor === null) redirect("/join");
  return { actor, context: { ...actor, sessionId: visitId(await cookies()) } };
}

type Context = Awaited<ReturnType<typeof signedIn>>["context"];

// The finish of a quiz, once: on the page, or when a start closes one left open (owner,
// 2026-10-28, Q-P2-28), so the metrics count both.
function recordFinish(
  attemptId: string,
  done: QuizFinish,
  context: Context,
): void {
  const { checkpoint } = done;
  const counts = { answered: done.answered, correct: done.correct };
  if (checkpoint === null)
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
async function closeLeftOpen(userId: string, context: Context): Promise<void> {
  for (const closed of await quizzes().closeStale(userId))
    recordFinish(closed.attemptId, closed, context);
}

export async function startQuizAction(form: FormData): Promise<void> {
  const { actor, context } = await signedIn();
  const parsed = Start.safeParse({
    itemId: textField(form, "itemId"),
    momentId: textField(form, "momentId") || undefined,
    chip: textField(form, "chip"),
  });
  if (!parsed.success) redirect("/");
  const { itemId, momentId, chip } = parsed.data;
  await closeLeftOpen(actor.userId, context);
  const started = await quizzes().start(actor.userId, itemId, momentId ?? null);
  // No live question (yet, or its rights changed): back where it was offered.
  if (started === null) redirect(sameSitePath(textField(form, "back"), "/"));
  if (started.firstTime)
    events().emit(
      "quiz_started",
      {
        attempt_id: started.attemptId,
        kind: "test",
        item_id: itemId,
        moment_id: momentId ?? null,
      },
      context,
    );
  redirect(`/quiz/${started.attemptId}?chip=${chip}`);
}

// P2-W9-S05 (Q-P2-17): a review session over the concepts that have come due.
const Review = z.object({ chip: z.enum(CHIPS) });

export async function startReviewAction(form: FormData): Promise<void> {
  const { actor, context } = await signedIn();
  const parsed = Review.safeParse({ chip: textField(form, "chip") });
  if (!parsed.success) redirect("/library");
  await closeLeftOpen(actor.userId, context);
  const started = await quizzes().startReview(actor.userId);
  // Nothing due any more (rated elsewhere meanwhile): the queue shows that.
  if (started === null) redirect("/library");
  if (started.firstTime)
    events().emit(
      "quiz_started",
      {
        attempt_id: started.attemptId,
        kind: "review",
        item_id: null,
        moment_id: null,
      },
      context,
    );
  redirect(`/quiz/${started.attemptId}?chip=${parsed.data.chip}`);
}

// P2-W10-S04 (§5F, Q-P2-26): a checkpoint on a section of the user's active path.
const Checkpoint = z.object({
  sectionId: z.string().regex(BIGINT_ID),
  chip: z.enum(CHIPS),
});

export async function startCheckpointAction(form: FormData): Promise<void> {
  const { actor, context } = await signedIn();
  const parsed = Checkpoint.safeParse({
    sectionId: textField(form, "sectionId"),
    chip: textField(form, "chip"),
  });
  if (!parsed.success) redirect("/paths");
  const { sectionId, chip } = parsed.data;
  await closeLeftOpen(actor.userId, context);
  const started = await quizzes().startCheckpoint(actor.userId, sectionId);
  // Not ready (or passed meanwhile): the path shows where it stands.
  if (started === null)
    redirect(sameSitePath(textField(form, "back"), "/paths"));
  if (started.firstTime)
    events().emit(
      "checkpoint_started",
      {
        attempt_id: started.attemptId,
        path_id: started.pathId,
        section_id: sectionId,
      },
      context,
    );
  redirect(`/quiz/${started.attemptId}?chip=${chip}`);
}

// P2-W11-S06 (Q-P2-35): a chapter checkpoint of the user's book.
const BookCheckpoint = z.object({
  chapterId: z.string().regex(BIGINT_ID),
  chip: z.enum(CHIPS),
});

export async function startBookCheckpointAction(form: FormData): Promise<void> {
  const { actor, context } = await signedIn();
  const parsed = BookCheckpoint.safeParse({
    chapterId: textField(form, "chapterId"),
    chip: textField(form, "chip"),
  });
  if (!parsed.success) redirect("/paths#your-books");
  const { chapterId, chip } = parsed.data;
  await closeLeftOpen(actor.userId, context);
  const started = await quizzes().startBookCheckpoint(actor.userId, chapterId);
  // Not ready (or not theirs): the chapter's end says where it stands.
  if (started === null)
    redirect(sameSitePath(textField(form, "back"), "/paths#your-books"));
  if (started.firstTime)
    events().emit(
      "book_checkpoint_started",
      {
        attempt_id: started.attemptId,
        book_id: started.bookId,
        chapter_id: chapterId,
      },
      context,
    );
  redirect(`/quiz/${started.attemptId}?chip=${chip}`);
}

export async function answerQuizAction(form: FormData): Promise<void> {
  const { actor, context } = await signedIn();
  const parsed = Answer.safeParse(Object.fromEntries(form));
  if (!parsed.success) redirect("/");
  const { attemptId, questionId, chosen, chip } = parsed.data;
  const got = await quizzes().answer(
    actor.userId,
    attemptId,
    questionId,
    chosen,
  );
  // Late, or not this attempt's open question: the quiz page shows where it stands.
  if (got === null || got === "late")
    redirect(`/quiz/${attemptId}?chip=${chip}`);
  if (got.firstTime)
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
  redirect(`/quiz/${attemptId}?chip=${chip}&answered=${questionId}`);
}

// P2-W9-S07 (Q-2, Q-P2-18): a flag on an answered question, with its reason.
const Flag = z.object({
  attemptId: z.string().regex(BIGINT_ID),
  questionId: z.string().regex(BIGINT_ID),
  reason: z.enum(FLAG_REASON_KEYS),
  chip: z.enum(CHIPS),
});

export async function flagQuestionAction(form: FormData): Promise<void> {
  const { actor, context } = await signedIn();
  const parsed = Flag.safeParse(Object.fromEntries(form));
  if (!parsed.success) redirect("/");
  const { attemptId, questionId, reason, chip } = parsed.data;
  if (await quizzes().flag(actor.userId, attemptId, questionId, reason))
    events().emit(
      "question_flagged",
      { question_id: questionId, reason },
      context,
    );
  redirect(`/quiz/${attemptId}?chip=${chip}&answered=${questionId}`);
}

export async function finishQuizAction(form: FormData): Promise<void> {
  const { actor, context } = await signedIn();
  const parsed = Finish.safeParse(Object.fromEntries(form));
  if (!parsed.success) redirect("/");
  const { attemptId, chip, leave } = parsed.data;
  const done = await quizzes().finish(actor.userId, attemptId);
  if (done === null) redirect("/");
  const { checkpoint } = done;
  if (done.firstTime) recordFinish(attemptId, done, context);
  redirect(
    leave === undefined
      ? `/quiz/${attemptId}/results?chip=${chip}`
      : leave === "library"
        ? "/library"
        : leave === "path" && checkpoint !== null
          ? checkpointHome(checkpoint.at)
          : `/?chip=${chip}`,
  );
}
