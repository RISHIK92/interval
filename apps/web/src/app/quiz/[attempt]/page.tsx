import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { CHIPS } from "../../../server/chips";
import { quizzes, sessionReader } from "../../../server/container";
import { BIGINT_ID } from "../../../server/ports";
import {
  answerQuizAction,
  finishQuizAction,
  flagQuestionAction,
} from "../actions";
import { FLAG_REASON_KEYS, FLAG_REASONS } from "../flagReasons";
import { Countdown } from "./Countdown";

export const dynamic = "force-dynamic";

const Query = z.object({
  chip: z.enum(CHIPS),
  answered: z.string().regex(BIGINT_ID).optional(),
});

const LETTERS = ["A", "B", "C", "D"];
const OPTION =
  "flex w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left";
const FINISH_FORM = "quiz-finish";
const EXIT = "quiz-exit";

// Test 60s (Q-P2-14, P2-W9-S02; wireframe 12, variant test): one question at a time
// with instant feedback, on the server's clock. Rendering serves the next question
// (a refresh gets the same one); only <a> links lead here, which never prefetch.
export default async function QuizPage({
  params,
  searchParams,
}: {
  params: Promise<{ attempt: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await sessionReader().current(await headers());
  if (actor === null) redirect("/join");
  const { attempt: attemptId } = await params;
  const parsed = Query.safeParse(await searchParams);
  if (!BIGINT_ID.test(attemptId) || !parsed.success) redirect("/");
  const { chip, answered } = parsed.data;
  const attempt = await quizzes().attempt(actor.userId, attemptId);
  if (attempt === null) redirect("/");
  if (attempt.finishedAt !== null)
    redirect(`/quiz/${attemptId}/results?chip=${chip}`);
  const here = `/quiz/${attemptId}?chip=${chip}`;

  let body;
  if (answered !== undefined) {
    const feedback = await quizzes().answered(
      actor.userId,
      attemptId,
      answered,
    );
    if (feedback === null) redirect(here);
    body = (
      <>
        <p className="text-lg font-semibold">{feedback.stem}</p>
        <ol className="flex flex-col gap-2">
          {feedback.options.map((option, i) => {
            const right = i === feedback.correctOption;
            const chosen = i === feedback.chosen;
            return (
              <li
                key={LETTERS[i]}
                className={`${OPTION} ${right ? "border-go bg-go-soft" : chosen ? "border-wrong" : "border-hairline"}`}
              >
                <Letter i={i} />
                <span className="min-w-0 flex-1">{option}</span>
                {/* An icon and a word, never colour alone (wireframe 12). */}
                {right ? (
                  <Mark icon="M5 12l5 5 9-10">
                    {chosen ? "Correct" : "Right answer"}
                  </Mark>
                ) : chosen ? (
                  <Mark icon="M6 6l12 12M18 6L6 18">Your answer</Mark>
                ) : null}
              </li>
            );
          })}
        </ol>
        <p
          role="status"
          className={`rounded-2xl px-4 py-3 font-semibold ${feedback.correct ? "bg-go-soft" : "bg-well"}`}
        >
          {feedback.correct ? "Correct." : "Not quite."}
        </p>
        <div className="flex flex-col gap-2">
          <a
            href={here}
            className="inline-flex items-center justify-center rounded-full bg-ink px-5 py-3 font-semibold text-page"
          >
            Next question
          </a>
        </div>
        {/* P2-W9-S07 (Q-2, Q-P2-18): a flagged question leaves quizzes until an
          admin checks it. */}
        {feedback.flagged ? (
          <p role="status" className="text-sm text-ink-muted">
            Thanks. This question is out of quizzes until it&apos;s checked.
          </p>
        ) : (
          <details className="rounded-2xl border border-hairline px-4 py-3">
            <summary className="cursor-pointer text-sm font-semibold">
              Report a problem with this question
            </summary>
            <form
              action={flagQuestionAction}
              className="mt-3 flex flex-col gap-2"
            >
              <input type="hidden" name="attemptId" value={attemptId} />
              <input type="hidden" name="questionId" value={answered} />
              <input type="hidden" name="chip" value={chip} />
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-1 text-sm text-ink-muted">
                  What&apos;s wrong with it?
                </legend>
                {FLAG_REASON_KEYS.map((key) => (
                  <label key={key} className="flex items-center gap-2 text-sm">
                    <input type="radio" name="reason" value={key} required />
                    {FLAG_REASONS[key]}
                  </label>
                ))}
              </fieldset>
              <button
                type="submit"
                className="self-start rounded-full border border-hairline px-4 py-2 text-sm font-semibold"
              >
                Send report
              </button>
            </form>
          </details>
        )}
      </>
    );
  } else {
    const question = await quizzes().next(actor.userId, attemptId);
    if (question === null) redirect("/");
    body =
      question === "over" ? (
        <div className="flex flex-col gap-4">
          <p role="status" className="text-lg font-semibold">
            {/* Out of questions before the clock: the sprint ends early (Q-P2-14). */}
            {attempt.review
              ? "That's every concept due."
              : attempt.secondsLeft !== null && attempt.secondsLeft > 0
                ? "That's every question for now."
                : "Time's up."}
          </p>
          <button
            type="submit"
            form={FINISH_FORM}
            className="inline-flex items-center justify-center rounded-full bg-ink px-5 py-3 font-semibold text-page"
          >
            See results
          </button>
        </div>
      ) : (
        <form action={answerQuizAction} className="flex flex-col gap-4">
          <input type="hidden" name="attemptId" value={attemptId} />
          <input type="hidden" name="questionId" value={question.questionId} />
          <input type="hidden" name="chip" value={chip} />
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-3 text-lg font-semibold">
              {question.stem}
            </legend>
            {question.options.map((option, i) => (
              <button
                key={LETTERS[i]}
                type="submit"
                name="chosen"
                value={String(i)}
                className={`${OPTION} cursor-pointer border-hairline hover:bg-well focus-visible:bg-well`}
              >
                <Letter i={i} />
                <span className="min-w-0 flex-1">{option}</span>
              </button>
            ))}
          </fieldset>
        </form>
      );
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-4 px-4 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
      <h1 className="sr-only">Test yourself: {attempt.title}</h1>
      <form id={FINISH_FORM} action={finishQuizAction}>
        <input type="hidden" name="attemptId" value={attemptId} />
        <input type="hidden" name="chip" value={chip} />
      </form>
      <header className="flex items-center gap-3">
        {/* Owner, 2026-10-28: no Finish button; Close warns first. A native popover:
          no script, no browser dialog. */}
        <button
          type="button"
          popoverTarget={EXIT}
          aria-label="Close"
          title="Close"
          className="flex size-9 cursor-pointer items-center justify-center rounded-full border border-hairline"
        >
          <Glyph path="M6 6l12 12M18 6L6 18" />
        </button>
        <div
          id={EXIT}
          popover="auto"
          role="alertdialog"
          aria-labelledby={`${EXIT}-title`}
          className="m-auto w-[min(22rem,calc(100vw-2rem))] rounded-2xl border border-hairline bg-page p-5 text-ink shadow-card backdrop:bg-black/40"
        >
          <p id={`${EXIT}-title`} className="font-semibold">
            {attempt.review ? "Exit the review?" : "Exit the test?"}
          </p>
          <p className="mt-1 text-sm text-ink-muted">
            {attempt.review
              ? "Exiting ends this review. Concepts you haven't answered stay due."
              : "Exiting now ends this test and will affect your score."}
          </p>
          <div className="mt-4 flex flex-col gap-2">
            <form action={finishQuizAction}>
              <input type="hidden" name="attemptId" value={attemptId} />
              <input type="hidden" name="chip" value={chip} />
              <input
                type="hidden"
                name="leave"
                value={attempt.review ? "library" : "feed"}
              />
              <button
                type="submit"
                className="w-full cursor-pointer rounded-full border border-wrong px-5 py-3 font-semibold"
              >
                {attempt.review ? "Exit review" : "Exit test"}
              </button>
            </form>
            <button
              type="button"
              popoverTarget={EXIT}
              popoverTargetAction="hide"
              className="w-full cursor-pointer rounded-full bg-ink px-5 py-3 font-semibold text-page"
            >
              Keep going
            </button>
          </div>
        </div>
        <p className="flex-1 font-semibold">
          {attempt.review ? "Review" : "Test yourself · 60s"}
        </p>
        <p className="text-sm text-ink-muted">{attempt.answered} answered</p>
      </header>
      {/* An answer taken in the grace shows its feedback before the results; a
        review has no clock. */}
      {attempt.endsAt === null ? null : (
        <Countdown
          endsAt={attempt.endsAt.toISOString()}
          finishForm={answered === undefined ? FINISH_FORM : null}
        />
      )}
      <p className="text-sm text-ink-muted">{attempt.title}</p>
      {body}
      <p className="mt-auto text-center text-xs text-ink-muted">
        {attempt.review
          ? "One question per concept due for review"
          : attempt.momentId === null
            ? "Questions from this article"
            : "Questions from this section"}
      </p>
    </main>
  );
}

function Letter({ i }: { i: number }) {
  return (
    <span
      aria-hidden="true"
      className="flex size-7 shrink-0 items-center justify-center rounded-full bg-well text-sm font-semibold"
    >
      {LETTERS[i]}
    </span>
  );
}

function Mark({ icon, children }: { icon: string; children: string }) {
  return (
    <span className="flex shrink-0 items-center gap-1 text-sm font-semibold">
      <Glyph path={icon} />
      {children}
    </span>
  );
}

function Glyph({ path }: { path: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="size-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={path} />
    </svg>
  );
}
