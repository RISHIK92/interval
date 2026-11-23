"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import { Button } from "../ui/Button";

// plan: the step's name in the wide screens' "Your plan so far" list.
export type Step = {
  title: string;
  subtitle?: string;
  plan: string;
  fields: ReactNode;
};

const tick = (className: string) => (
  <svg
    aria-hidden="true"
    viewBox="0 0 24 24"
    className={className}
    fill="none"
    stroke="currentColor"
    strokeWidth="2.6"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

// One step at a time (wireframe screen 1), inside the one onboarding form: hidden steps
// keep their inputs in the DOM so every choice posts together at the end. Wide screens
// (web design, 2026-11) add a header with the wordmark, a footer with Back, and the plan
// so far beside the step, filled in from the answers as they are picked.
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
  // Each step's picked options, by their visible names.
  const [picked, setPicked] = useState<string[][]>(() => steps.map(() => []));
  const root = useRef<HTMLDivElement>(null);
  const sync = () => {
    const el = root.current;
    if (el === null) return;
    setPicked(
      steps.map((_, i) =>
        [
          ...el.querySelectorAll<HTMLInputElement>(
            `[data-step="${String(i)}"] input:checked`,
          ),
        ].map((input) => input.dataset["label"] ?? input.value),
      ),
    );
  };
  // The browser may restore checked inputs (back button) without a change event.
  useEffect(sync, [steps]);
  const answered = picked.map((names) => names.length > 0);
  const last = step === steps.length - 1;
  const back = () => {
    setStep(step - 1);
  };
  return (
    <div ref={root} onChange={sync} className="flex min-h-dvh flex-col">
      <div className="flex items-center gap-3 lg:gap-5 lg:border-b lg:border-hairline lg:px-7 lg:py-[18px]">
        <span className="hidden flex-1 items-center gap-2.5 text-[22px] font-bold tracking-[-0.03em] lg:flex">
          <span
            aria-hidden="true"
            className="flex size-[30px] items-center justify-center gap-[3px] rounded-[9px] bg-ink"
          >
            <span className="h-3.5 w-1 rounded-sm bg-page" />
            <span className="mb-2 size-1.5 self-end rounded-full bg-go" />
          </span>
          Interval
        </span>
        <button
          type="button"
          aria-label="Back"
          onClick={back}
          className={`flex size-10 shrink-0 items-center justify-center rounded-full border border-hairline lg:hidden ${step === 0 ? "invisible" : ""}`}
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
        <div className="flex flex-1 items-center gap-3 lg:max-w-[420px] lg:basis-[420px]">
          <div className="flex flex-1 gap-1.5 lg:gap-1">
            {/* Wide screens count the account as the plan's first step, as the list does. */}
            <span className="hidden h-2 flex-1 rounded bg-go lg:block" />
            {steps.map((s, i) => (
              <span
                key={s.title}
                className={`h-1.5 flex-1 rounded-full lg:h-2 lg:rounded ${i <= step ? "bg-go" : "bg-track"}`}
              />
            ))}
          </div>
          <span className="text-numbers text-ink-muted lg:text-[13px] lg:font-semibold">
            <span className="lg:hidden">
              {Math.round(((step + 1) / steps.length) * 100)}%
            </span>
            <span className="hidden lg:inline">
              {Math.round(((step + 2) / (steps.length + 1)) * 100)}%
            </span>
          </span>
        </div>
        <span aria-hidden="true" className="hidden flex-1 lg:block" />
      </div>
      <div className="flex flex-1 flex-col lg:flex-row">
        <div className="flex flex-1 flex-col lg:px-12 lg:py-10">
          <div className="flex flex-1 flex-col lg:mx-auto lg:w-full lg:max-w-[640px]">
            {step === 0 ? (
              <p className="mt-6 self-start rounded-full bg-go/15 px-3 py-1 text-sm font-semibold text-go-text lg:mt-0 lg:flex lg:h-7 lg:items-center lg:gap-1.5 lg:pl-2.5 lg:text-[13px]">
                {/* Phones keep the text tick; wide screens draw it. */}
                <span className="lg:hidden">✓ </span>
                {tick("hidden size-3.5 lg:block")}
                Account created
              </p>
            ) : null}
            {steps.map((s, i) => (
              <fieldset
                key={s.title}
                data-step={i}
                hidden={i !== step}
                aria-labelledby={`step-${String(i)}`}
                className="mt-4 lg:mb-6"
              >
                <h1
                  id={`step-${String(i)}`}
                  className="text-display lg:text-[36px] lg:leading-[1.1] lg:tracking-[-0.03em]"
                >
                  {s.title}
                </h1>
                {s.subtitle === undefined ? null : (
                  <p className="mt-2 text-ink-muted lg:text-[17px] lg:text-ink-soft">
                    {s.subtitle}
                  </p>
                )}
                {alert !== null && i === start ? (
                  <p role="alert" className="mt-3 text-wrong">
                    {alert}
                  </p>
                ) : null}
                <div className="mt-6">{s.fields}</div>
              </fieldset>
            ))}
            <div className="sticky bottom-0 mt-auto bg-page pt-4 pb-6 lg:static lg:flex lg:items-center lg:gap-2.5 lg:border-t lg:border-hairline lg:pt-5 lg:pb-0">
              <button
                type="button"
                onClick={back}
                className={`hidden h-12 items-center gap-2 rounded-full border-[1.5px] border-hairline-strong px-[18px] text-[15px] font-semibold lg:flex ${step === 0 ? "invisible" : ""}`}
              >
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
                  <path d="M19 12H5M12 19l-7-7 7-7" />
                </svg>
                Back
              </button>
              <span className="hidden flex-1 lg:block" />
              <Button
                // Continue never submits, so a step can't be skipped with Enter either.
                type={last ? "submit" : "button"}
                // The last step submits everything, so it waits for every step's answer.
                disabled={
                  last ? !answered.every(Boolean) : answered[step] !== true
                }
                onClick={
                  last
                    ? undefined
                    : () => {
                        setStep(step + 1);
                      }
                }
                className="w-full lg:h-[52px] lg:w-auto lg:px-7"
              >
                {last ? "Show my feed" : "Continue"}
              </Button>
            </div>
          </div>
        </div>
        <aside
          aria-label="Your plan so far"
          className="hidden flex-col gap-[18px] bg-well px-8 py-10 lg:flex lg:w-[320px] lg:shrink-0"
        >
          <div>
            <p className="text-[13px] font-semibold text-ink-muted">
              Your plan so far
            </p>
            <p className="mt-0.5 text-xl font-bold tracking-[-0.015em]">
              It fills in as you answer
            </p>
          </div>
          <ol className="flex flex-col">
            <PlanRow state="done" number={1} name="Account created" />
            {steps.map((s, i) => (
              <PlanRow
                key={s.title}
                state={i < step ? "done" : i === step ? "current" : "later"}
                number={i + 2}
                name={s.plan}
                answer={picked[i]?.join(" · ")}
              />
            ))}
          </ol>
        </aside>
      </div>
    </div>
  );
}

function PlanRow({
  state,
  number,
  name,
  answer,
}: {
  state: "done" | "current" | "later";
  number: number;
  name: string;
  answer?: string | undefined;
}) {
  const dot =
    state === "done"
      ? "bg-go text-page"
      : state === "current"
        ? "border-2 border-select bg-select/10 text-ink"
        : "border-[1.5px] border-hairline-strong text-ink-muted";
  return (
    <li className="flex items-start gap-3 py-2.5">
      <span
        className={`flex size-7 shrink-0 items-center justify-center rounded-full text-[13px] font-bold tabular-nums ${dot}`}
      >
        {state === "done" ? tick("size-3.5") : number}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-px">
        <span
          className={`text-[15px] ${state === "later" ? "font-medium text-ink-muted" : "font-semibold"}`}
        >
          {name}
        </span>
        {answer === undefined || answer === "" ? null : (
          <span className="text-[13px] text-ink-muted">{answer}</span>
        )}
      </span>
    </li>
  );
}
