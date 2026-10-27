"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { events, quizzes, sessionReader } from "../../server/container";
import { BIGINT_ID } from "../../server/ports";
import { visitId } from "../../server/visits";
import { sameSitePath, textField } from "../form";

// Test 60s (Q-P2-14, Q-P2-20, P2-W9-S01): the server holds the sprint's clock and
// checks each answer; these validate the form and record what happened once.
const Start = z.object({
  itemId: z.string().regex(BIGINT_ID),
  momentId: z.string().regex(BIGINT_ID).optional(),
});
// LOAD-5: the attempt and question are the answer's idempotency key.
const Answer = z.object({
  attemptId: z.string().regex(BIGINT_ID),
  questionId: z.string().regex(BIGINT_ID),
  chosen: z.coerce.number().int().min(0).max(3),
});
const Finish = z.object({ attemptId: z.string().regex(BIGINT_ID) });

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
  });
  if (!parsed.success) redirect("/");
  const { itemId, momentId } = parsed.data;
  const started = await quizzes().start(actor.userId, itemId, momentId ?? null);
  // No live question (yet, or its rights changed): back where it was offered.
  if (started === null) redirect(sameSitePath(textField(form, "back"), "/"));
  if (started.firstTime)
    events().emit(
      "quiz_started",
      {
        attempt_id: started.attemptId,
        item_id: itemId,
        moment_id: momentId ?? null,
      },
      context,
    );
  redirect(`/quiz/${started.attemptId}`);
}

export async function answerQuizAction(form: FormData): Promise<void> {
  const { actor, context } = await signedIn();
  const parsed = Answer.safeParse(Object.fromEntries(form));
  if (!parsed.success) redirect("/");
  const { attemptId, questionId, chosen } = parsed.data;
  const got = await quizzes().answer(
    actor.userId,
    attemptId,
    questionId,
    chosen,
  );
  // Late, or not this attempt's open question: the quiz page shows where it stands.
  if (got === null || got === "late") redirect(`/quiz/${attemptId}`);
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
  redirect(`/quiz/${attemptId}?answered=${questionId}`);
}

export async function finishQuizAction(form: FormData): Promise<void> {
  const { actor, context } = await signedIn();
  const parsed = Finish.safeParse(Object.fromEntries(form));
  if (!parsed.success) redirect("/");
  const { attemptId } = parsed.data;
  const done = await quizzes().finish(actor.userId, attemptId);
  if (done === null) redirect("/");
  if (done.firstTime)
    events().emit(
      "quiz_finished",
      { attempt_id: attemptId, answered: done.answered, correct: done.correct },
      context,
    );
  redirect(`/quiz/${attemptId}/results`);
}
