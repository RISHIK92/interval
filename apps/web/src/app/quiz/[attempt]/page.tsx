import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { CHIPS } from "../../../server/chips";
import { quizzes, sessionReader } from "../../../server/container";
import { points } from "../../../server/estimation";
import { BIGINT_ID } from "../../../server/ports";
import {
  answerEstimateAction,
  answerQuizAction,
  finishQuizAction,
  flagQuestionAction,
} from "../actions";
import { amount, verdict } from "../estimateText";
import { FLAG_REASON_KEYS, FLAG_REASONS } from "../flagReasons";
import { SourceAnchor, sourceLink } from "../sourceLink";
import { Countdown } from "./Countdown";

export const dynamic = "force-dynamic";

const Query = z.object({
  chip: z.enum(CHIPS),
  answered: z.string().regex(BIGINT_ID).optional(),
});

const LETTERS = ["A", "B", "C", "D"];
const EXIT_TEXT = {
  test: {
    title: "Exit the test?",
    body: "Exiting now ends this test and will affect your score.",
    button: "Exit test",
    leave: "feed",
  },
  review: {
    title: "Exit the review?",
    body: "Exiting ends this review. Concepts you haven't answered stay due.",
    button: "Exit review",
    leave: "library",
  },
  sprint: {
    title: "Exit the sprint?",
    body: "Exiting now ends this sprint and counts what you answered.",
    button: "Exit sprint",
    leave: "play",
  },
  estimation: {
    title: "Exit the round?",
    body: "Exiting now ends this round and counts what you answered.",
    button: "Exit round",
    leave: "play",
  },
  checkpoint: {
    title: "Exit the checkpoint?",
    body: "Exiting now ends this checkpoint and counts what you answered. You can try again.",
    button: "Exit checkpoint",
    leave: "path",
  },
} as const;
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
  const { checkpoint } = attempt;
  const kind = attempt.review
    ? "review"
    : attempt.estimation !== null
      ? "estimation"
      : attempt.sprint
        ? "sprint"
        : checkpoint === null
          ? "test"
          : "checkpoint";

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
        {feedback.kind === "estimate" ? (
          <>
            {/* P3-W13-S04, S03b (C-27, AI-3): the real answer and where it comes
              from: a hand-written question's quoted sentence and page, or a
              moment's section, never its quote (Q-P2-12). */}
            <dl className="grid grid-cols-2 gap-2">
              <div className="rounded-2xl bg-well px-4 py-3">
                <dt className="text-sm text-ink-muted">Your guess</dt>
                <dd className="font-semibold">
                  {amount(feedback.guess, feedback.unit)}
                </dd>
              </div>
              <div className="rounded-2xl bg-go-soft px-4 py-3">
                <dt className="text-sm text-ink-muted">Answer</dt>
                <dd className="font-semibold">
                  {amount(feedback.answer, feedback.unit)}
                </dd>
              </div>
            </dl>
            <p
              role="status"
              className={`rounded-2xl px-4 py-3 font-semibold ${feedback.score === 1 ? "bg-go-soft" : "bg-well"}`}
            >
              {verdict(feedback.score)}: {points(feedback.score)} points
            </p>
            {feedback.source === null ? null : (
              <blockquote className="flex flex-col gap-1 border-l-2 border-hairline pl-3 text-sm">
                {feedback.source.kind === "page" ? (
                  <p>&ldquo;{feedback.source.citation}&rdquo;</p>
                ) : null}
                <SourceAnchor
                  link={sourceLink(feedback.source, chip, actor.isGuest)}
                  className="text-ink-muted underline underline-offset-2"
                />
              </blockquote>
            )}
          </>
        ) : (
          <>
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
          </>
        )}
        <div className="flex flex-col gap-2">
          <a
            href={here}
            className="inline-flex items-center justify-center rounded-full bg-ink px-5 py-3 font-semibold text-page"
          >
            Next question
          </a>
        </div>
        {/* P2-W9-S07 (Q-2, Q-P2-18): a flagged question leaves quizzes until an
          admin checks it. Not from guests (ADR-0029): they're free to make, so a few
          could empty the bank. */}
        {actor.isGuest ? null : feedback.flagged ? (
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
      ) : question.kind === "estimate" ? (
        <form action={answerEstimateAction} className="flex flex-col gap-4">
          <input type="hidden" name="attemptId" value={attemptId} />
          <input type="hidden" name="questionId" value={question.questionId} />
          <input type="hidden" name="chip" value={chip} />
          <label htmlFor="guess" className="text-lg font-semibold">
            {question.stem}
          </label>
          <div className="flex items-center gap-3">
            <input
              id="guess"
              name="guess"
              type="number"
              inputMode="decimal"
              step="any"
              min="0"
              required
              autoFocus
              className="min-w-0 flex-1 rounded-2xl border border-hairline bg-page px-4 py-3 text-lg"
            />
            <span className="shrink-0 font-semibold">{question.unit}</span>
          </div>
          <button
            type="submit"
            className="inline-flex cursor-pointer items-center justify-center rounded-full bg-ink px-5 py-3 font-semibold text-page"
          >
            Answer
          </button>
        </form>
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
      <h1 className="sr-only">
        {kind === "sprint" || kind === "estimation"
          ? attempt.title
          : `${kind === "checkpoint" ? "Checkpoint" : "Test yourself"}: ${attempt.title}`}
      </h1>
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
            {EXIT_TEXT[kind].title}
          </p>
          <p className="mt-1 text-sm text-ink-muted">{EXIT_TEXT[kind].body}</p>
          <div className="mt-4 flex flex-col gap-2">
            <form action={finishQuizAction}>
              <input type="hidden" name="attemptId" value={attemptId} />
              <input type="hidden" name="chip" value={chip} />
              <input type="hidden" name="leave" value={EXIT_TEXT[kind].leave} />
              <button
                type="submit"
                className="w-full cursor-pointer rounded-full border border-wrong px-5 py-3 font-semibold"
              >
                {EXIT_TEXT[kind].button}
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
          {kind === "review"
            ? "Review"
            : kind === "sprint" || kind === "estimation"
              ? attempt.title
              : kind === "checkpoint"
                ? "Checkpoint · 60s"
                : "Test yourself · 60s"}
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
      {/* A game's title is its header. */}
      {kind === "sprint" || kind === "estimation" ? null : (
        <p className="text-sm text-ink-muted">{attempt.title}</p>
      )}
      {body}
      <p className="mt-auto text-center text-xs text-ink-muted">
        {checkpoint !== null
          ? `Pass ${String(checkpoint.passMark)} of ${String(checkpoint.size)} ${
              checkpoint.at.kind === "book"
                ? "on this chapter"
                : checkpoint.next === null
                  ? "to finish the path"
                  : `to unlock ${checkpoint.next.join(", ")}`
            }`
          : attempt.review
            ? "One question per concept due for review"
            : attempt.sprint
              ? "Questions picked for you"
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
