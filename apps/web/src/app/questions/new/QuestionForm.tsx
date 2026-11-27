"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button } from "../../ui/Button";
import { FIELD } from "../../ui/field";
import { type QuestionState, submitQuestionAction } from "./actions";
import { remainingText } from "./remaining";

const LETTERS = ["A", "B", "C", "D"] as const;

// Q-P7-05: a stem, four answers with the correct one chosen, and a quote from the
// section. The key comes from the page, so a double submit is one question (LOAD-5).
export function QuestionForm({
  momentId,
  idempotencyKey,
}: {
  momentId: string;
  idempotencyKey: string;
}) {
  const [state, action, pending] = useActionState<QuestionState, FormData>(
    submitQuestionAction,
    null,
  );
  if (state?.status === "sent") {
    const left = remainingText(state.remaining);
    return (
      <div role="status" className="flex flex-col gap-3">
        <p className="text-lg font-semibold">
          Thanks — it&apos;ll be checked, then reviewed.
        </p>
        <p className="text-ink-muted">
          Once it&apos;s approved, it may be asked in practice. Other players
          won&apos;t see your name. This page shows where it stands.
        </p>
        {left === null ? null : <p className="text-ink-muted">{left}</p>}
        <Link href="/" className="font-semibold text-select">
          Back to your feed
        </Link>
      </div>
    );
  }
  const values = state?.values;
  return (
    // Keyed by the refusal, so the fields show what was typed (React resets a form
    // after its action).
    <form
      key={state === null ? "new" : state.message}
      action={action}
      className="flex flex-col gap-5"
    >
      <input type="hidden" name="momentId" value={momentId} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <label className="text-section">
        Question
        <textarea
          name="stem"
          required
          maxLength={500}
          rows={3}
          defaultValue={values?.stem}
          className={FIELD}
        />
      </label>
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-section">
          Answers{" "}
          <span className="font-normal text-ink-muted">
            · choose the correct one
          </span>
        </legend>
        {LETTERS.map((letter, i) => (
          <div key={letter} className="flex items-center gap-3">
            <input
              type="radio"
              name="correct"
              value={String(i)}
              required
              defaultChecked={values?.correct === String(i)}
              aria-label={`Answer ${letter} is correct`}
              className="size-5 shrink-0 accent-select"
            />
            <label className="flex-1">
              <span className="sr-only">{`Answer ${letter}`}</span>
              <input
                name={`option${String(i)}`}
                required
                maxLength={200}
                placeholder={`Answer ${letter}`}
                defaultValue={values?.options[i]}
                className={`${FIELD} mt-0`}
              />
            </label>
          </div>
        ))}
      </fieldset>
      <label className="text-section">
        Quote from the section
        <span className="block font-normal text-ink-muted">
          The words that settle the answer, copied from the section (3 words or
          more).
        </span>
        <textarea
          name="citation"
          required
          maxLength={300}
          rows={2}
          defaultValue={values?.citation}
          className={FIELD}
        />
      </label>
      {state?.status === "problem" ? (
        <p role="alert" className="text-wrong">
          {state.message}
        </p>
      ) : null}
      <Button type="submit" disabled={pending} className="self-start">
        Submit question
      </Button>
    </form>
  );
}
