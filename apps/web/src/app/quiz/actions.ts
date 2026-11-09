"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import type { Game } from "@interval/api-client";
import { z } from "zod";
import { CHIP_COOKIE, CHIPS, parseChip } from "../../server/chips";
import { events, quizzes, sessionReader } from "../../server/container";
import { BIGINT_ID, checkpointHome } from "../../server/ports";
import {
  answerChoice,
  answerEstimate,
  closeLeftOpen,
  finishAttempt,
  startCheckpoint,
  startGame,
  startTest,
} from "../../server/quiz-flow";
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
// P3-W13-S04: an estimate is a positive number (zod 4's numbers are finite).
const Estimate = z.object({
  attemptId: z.string().regex(BIGINT_ID),
  questionId: z.string().regex(BIGINT_ID),
  guess: z.coerce.number().positive(),
  chip: z.enum(CHIPS),
});
// Close leaves for where the quiz started (the feed, the Library for a review, the
// path for a checkpoint, Play for a game); otherwise the results.
const Finish = z.object({
  attemptId: z.string().regex(BIGINT_ID),
  chip: z.enum(CHIPS),
  leave: z.enum(["feed", "library", "path", "play"]).optional(),
});

async function signedIn() {
  const actor = await sessionReader().current(await headers());
  if (actor === null) redirect("/join");
  return { actor, context: { ...actor, sessionId: visitId(await cookies()) } };
}

export async function startQuizAction(form: FormData): Promise<void> {
  const { context } = await signedIn();
  const parsed = Start.safeParse({
    itemId: textField(form, "itemId"),
    momentId: textField(form, "momentId") || undefined,
    chip: textField(form, "chip"),
  });
  if (!parsed.success) redirect("/");
  const { itemId, momentId, chip } = parsed.data;
  const started = await startTest(context, itemId, momentId ?? null);
  // No live question (yet, or its rights changed): back where it was offered.
  if (started === null) redirect(sameSitePath(textField(form, "back"), "/"));
  redirect(`/quiz/${started.attemptId}?chip=${chip}`);
}

// P3-W13-S02 (§6.3): a solo game from Play (server/quiz-flow.ts).
async function startGameFromPlay(game: Game): Promise<void> {
  const { context } = await signedIn();
  const started = await startGame(context, game);
  if (started === "forbidden") redirect("/play");
  // Nothing to play: every question asked this week (Q-P3-04), or no daily set
  // today. Play says so.
  if (started === "none") redirect(`/play?${game}=none`);
  // A game has no feed to return to; the chip only rides along to the quiz pages.
  const chip = parseChip((await cookies()).get(CHIP_COOKIE)?.value) ?? "3-8";
  redirect(`/quiz/${started.attemptId}?chip=${chip}`);
}

export async function startSprintAction(): Promise<void> {
  await startGameFromPlay("sprint");
}

export async function startEstimationAction(): Promise<void> {
  await startGameFromPlay("estimation");
}

export async function startDailyAction(): Promise<void> {
  await startGameFromPlay("daily");
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
  const { context } = await signedIn();
  const parsed = Checkpoint.safeParse({
    sectionId: textField(form, "sectionId"),
    chip: textField(form, "chip"),
  });
  if (!parsed.success) redirect("/paths");
  const { sectionId, chip } = parsed.data;
  const started = await startCheckpoint(context, sectionId);
  // Not ready (or passed meanwhile): the path shows where it stands.
  if (started === null)
    redirect(sameSitePath(textField(form, "back"), "/paths"));
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
  const { context } = await signedIn();
  const parsed = Answer.safeParse(Object.fromEntries(form));
  if (!parsed.success) redirect("/");
  const { attemptId, questionId, chosen, chip } = parsed.data;
  const got = await answerChoice(context, attemptId, questionId, chosen);
  // Late, or not this attempt's open question: the quiz page shows where it stands.
  if (got === null || got === "late")
    redirect(`/quiz/${attemptId}?chip=${chip}`);
  redirect(`/quiz/${attemptId}?chip=${chip}&answered=${questionId}`);
}

// P3-W13-S04 (C-27): an estimate, scored by the server; the page then reveals the
// answer and its source.
export async function answerEstimateAction(form: FormData): Promise<void> {
  const { context } = await signedIn();
  const attemptId = textField(form, "attemptId");
  const parsed = Estimate.safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    const chip = parseChip(textField(form, "chip"));
    redirect(
      BIGINT_ID.test(attemptId) && chip !== null
        ? `/quiz/${attemptId}?chip=${chip}`
        : "/",
    );
  }
  const { questionId, guess, chip } = parsed.data;
  const got = await answerEstimate(
    context,
    parsed.data.attemptId,
    questionId,
    guess,
  );
  if (got === null || got === "late")
    redirect(`/quiz/${parsed.data.attemptId}?chip=${chip}`);
  redirect(
    `/quiz/${parsed.data.attemptId}?chip=${chip}&answered=${questionId}`,
  );
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
  // ADR-0029: a flag takes a question out of every quiz; guests can't.
  if (actor.isGuest)
    redirect(
      `/quiz/${parsed.data.attemptId}?chip=${parsed.data.chip}&answered=${parsed.data.questionId}`,
    );
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
  const { context } = await signedIn();
  const parsed = Finish.safeParse(Object.fromEntries(form));
  if (!parsed.success) redirect("/");
  const { attemptId, chip, leave } = parsed.data;
  const done = await finishAttempt(context, attemptId);
  if (done === null) redirect("/");
  const { checkpoint } = done;
  redirect(
    leave === undefined
      ? `/quiz/${attemptId}/results?chip=${chip}`
      : leave === "library"
        ? "/library"
        : leave === "play"
          ? "/play"
          : leave === "path" && checkpoint !== null
            ? checkpointHome(checkpoint.at)
            : `/?chip=${chip}`,
  );
}
