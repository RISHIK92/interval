"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import { Button } from "../ui/Button";

export type Step = { title: string; subtitle?: string; fields: ReactNode };

// One step at a time (wireframe screen 1), inside the one onboarding form: hidden steps
// keep their inputs in the DOM so every choice posts together at the end.
export function OnboardingSteps({
  steps,
  start,
  alert,
}: {
  steps: Step[];
  start: number;
  alert: string | null;
}) {
  const [step, setStep] = useState(start);
  const [answered, setAnswered] = useState<boolean[]>(() =>
    steps.map(() => false),
  );
  const root = useRef<HTMLDivElement>(null);
  const sync = () => {
    const el = root.current;
    if (el === null) return;
    setAnswered(
      steps.map(
        (_, i) =>
          el.querySelector(`[data-step="${String(i)}"] input:checked`) !== null,
      ),
    );
  };
  // The browser may restore checked inputs (back button) without a change event.
  useEffect(sync, [steps]);
  const last = step === steps.length - 1;
  return (
    <div ref={root} onChange={sync} className="flex min-h-dvh flex-col">
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label="Back"
          onClick={() => {
            setStep(step - 1);
          }}
          className={`flex size-10 shrink-0 items-center justify-center rounded-full border border-hairline ${step === 0 ? "invisible" : ""}`}
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5">
            <path
              d="M15 5l-7 7 7 7"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <div className="flex flex-1 gap-1.5">
          {steps.map((s, i) => (
            <span
              key={s.title}
              className={`h-1.5 flex-1 rounded-full ${i <= step ? "bg-go" : "bg-track"}`}
            />
          ))}
        </div>
        <span className="text-numbers text-ink-muted">
          {Math.round(((step + 1) / steps.length) * 100)}%
        </span>
      </div>
      {step === 0 ? (
        <p className="mt-6 self-start rounded-full bg-go/15 px-3 py-1 text-sm font-semibold text-go-text">
          ✓ Account created
        </p>
      ) : null}
      {steps.map((s, i) => (
        <fieldset
          key={s.title}
          data-step={i}
          hidden={i !== step}
          aria-labelledby={`step-${String(i)}`}
          className="mt-4"
        >
          <h1 id={`step-${String(i)}`} className="text-display">
            {s.title}
          </h1>
          {s.subtitle === undefined ? null : (
            <p className="mt-2 text-ink-muted">{s.subtitle}</p>
          )}
          {alert !== null && i === start ? (
            <p role="alert" className="mt-3 text-wrong">
              {alert}
            </p>
          ) : null}
          <div className="mt-6">{s.fields}</div>
        </fieldset>
      ))}
      <div className="sticky bottom-0 mt-auto bg-page pt-4 pb-6">
        <Button
          // Continue never submits, so a step can't be skipped with Enter either.
          type={last ? "submit" : "button"}
          // The last step submits everything, so it waits for every step's answer.
          disabled={last ? !answered.every(Boolean) : answered[step] !== true}
          onClick={
            last
              ? undefined
              : () => {
                  setStep(step + 1);
                }
          }
          className="w-full"
        >
          {last ? "Show my feed" : "Continue"}
        </Button>
      </div>
    </div>
  );
}
