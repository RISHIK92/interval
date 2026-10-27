"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { CHIPS } from "../../server/chips";
import { events, quizzes, sessionReader } from "../../server/container";
import { BIGINT_ID } from "../../server/ports";
import { visitId } from "../../server/visits";
import { sameSitePath, textField } from "../form";

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
// Close leaves for where the quiz started (the feed, or the Library for a review);
// otherwise the results.
const Finish = z.object({
  attemptId: z.string().regex(BIGINT_ID),
  chip: z.enum(CHIPS),
  leave: z.enum(["feed", "library"]).optional(),
});

async function signedIn() {
  const actor = await sessionReader().current(await headers());
  if (actor === null) redirect("/join");
  return { actor, context: { ...actor, sessionId: visitId(await cookies()) } };
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

export async function finishQuizAction(form: FormData): Promise<void> {
  const { actor, context } = await signedIn();
  const parsed = Finish.safeParse(Object.fromEntries(form));
  if (!parsed.success) redirect("/");
  const { attemptId, chip, leave } = parsed.data;
  const done = await quizzes().finish(actor.userId, attemptId);
  if (done === null) redirect("/");
  if (done.firstTime)
    events().emit(
      "quiz_finished",
      { attempt_id: attemptId, answered: done.answered, correct: done.correct },
      context,
    );
  redirect(
    leave === undefined
      ? `/quiz/${attemptId}/results?chip=${chip}`
      : leave === "library"
        ? "/library"
        : `/?chip=${chip}`,
  );
}
