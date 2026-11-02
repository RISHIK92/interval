"use client";

import { useEffect, useState } from "react";
import type { SprintState } from "../sprint-state";

const LETTERS = ["A", "B", "C", "D"];
const OPTION =
  "flex w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left";
const OUTCOME = { won: "You won", lost: "You lost", draw: "A draw" } as const;

function useSecondsLeft(endsAt: number): number {
  const left = () => Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
  const [seconds, setSeconds] = useState(left);
  useEffect(() => {
    const tick = () => {
      setSeconds(Math.max(0, Math.ceil((endsAt - Date.now()) / 1000)));
    };
    tick();
    const timer = setInterval(tick, 250);
    return () => {
      clearInterval(timer);
    };
  }, [endsAt]);
  return seconds;
}

function SecondsLeft({ endsAt }: { endsAt: number }) {
  return <>{useSecondsLeft(endsAt)}</>;
}

// The opponent's count: every score that isn't the player's own.
function theirs(scores: Record<string, number>, you: string | null): number {
  return Object.entries(scores)
    .filter(([player]) => player !== you)
    .reduce((sum, [, n]) => sum + n, 0);
}

// P3-W16-S04 (Q-P3-23): one match on screen, from its state. Right and wrong carry an
// icon and a word, never color alone (wireframe 12).
export function SprintView({
  state,
  answered,
  onAnswer,
}: {
  state: SprintState;
  answered: number | null; // the question just answered, until the next arrives
  onAnswer: (n: number, choice: number) => void;
}) {
  if (state.phase === "connecting")
    return (
      <p role="status" className="text-ink-muted">
        Opponent found. Connecting…
      </p>
    );
  if (state.phase === "cancelled")
    return (
      <p role="status" className="rounded-2xl bg-well px-4 py-3">
        Your opponent didn&apos;t join, so the match was cancelled.
      </p>
    );
  if (state.phase === "countdown")
    return (
      <div role="status" className="flex flex-col items-center gap-2 py-12">
        <p className="text-ink-muted">Get ready</p>
        <p className="text-display tabular-nums">
          <SecondsLeft endsAt={state.endsAt} />
        </p>
      </div>
    );
  if (state.phase === "playing") {
    const { question, last } = state;
    return (
      <div className="flex flex-col gap-5">
        <div className="flex items-center justify-between text-sm font-semibold tabular-nums">
          <p>
            You {state.you === null ? 0 : (state.scores[state.you] ?? 0)} ·
            Opponent {theirs(state.scores, state.you)}
          </p>
          <p aria-label="Seconds left">
            <SecondsLeft endsAt={state.endsAt} />s
          </p>
        </div>
        <p role="status" aria-live="polite" className="min-h-6 text-sm">
          {last === null ? null : last.correct ? (
            <span className="font-semibold text-go">✓ Right</span>
          ) : (
            <span className="font-semibold text-wrong">✗ Wrong</span>
          )}
        </p>
        {question === null ? (
          <p className="rounded-2xl bg-well px-4 py-3">
            You&apos;ve answered every question. Waiting for the clock.
          </p>
        ) : (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-3 text-lg font-semibold">
              {question.stem}
            </legend>
            {question.options.map((option, i) => (
              <button
                key={LETTERS[i]}
                type="button"
                disabled={answered === question.n}
                onClick={() => {
                  onAnswer(question.n, i);
                }}
                className={`${OPTION} cursor-pointer border-hairline disabled:opacity-60`}
              >
                <span className="font-semibold">{LETTERS[i]}</span>
                {option}
              </button>
            ))}
          </fieldset>
        )}
      </div>
    );
  }
  const you = state.you ?? "";
  const left = state.abandoned.some((p) => p !== you);
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-display">{OUTCOME[state.outcome]}</h2>
        {left ? (
          <p className="mt-1 text-ink-muted">Your opponent left the match.</p>
        ) : null}
        <p className="mt-2 font-semibold tabular-nums">
          You {state.totals[you] ?? 0} correct · Opponent{" "}
          {theirs(state.totals, you)} correct
        </p>
        <p className="mt-1 text-sm text-ink-muted">
          Your rating updates on Play in a moment.
        </p>
      </div>
      {state.questions.length === 0 ? null : (
        <ol className="flex flex-col gap-4">
          {state.questions.map((q) => (
            <li key={q.n} className="flex flex-col gap-2">
              <p className="font-semibold">{q.stem}</p>
              <ul className="flex flex-col gap-1.5">
                {q.options.map((option, i) => {
                  const right = i === q.correct;
                  const chosen = i === q.chosen;
                  return (
                    <li
                      key={LETTERS[i]}
                      className={`${OPTION} ${right ? "border-go bg-go-soft" : chosen ? "border-wrong" : "border-hairline"}`}
                    >
                      <span className="font-semibold">{LETTERS[i]}</span>
                      <span className="flex-1">{option}</span>
                      {right && chosen ? (
                        <span className="text-sm font-semibold">
                          ✓ Your answer, right
                        </span>
                      ) : right ? (
                        <span className="text-sm font-semibold">
                          ✓ Right answer
                        </span>
                      ) : chosen ? (
                        <span className="text-sm font-semibold">
                          ✗ Your answer
                        </span>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
              {q.chosen === null ? (
                <p className="text-sm text-ink-muted">Not answered</p>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
