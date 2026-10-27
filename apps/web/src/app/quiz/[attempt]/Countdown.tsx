"use client";

import { useEffect, useState } from "react";
import { QUIZ_SECONDS } from "../../../server/ports";

export function secondsLeft(endsAt: string, now: number): number {
  return Math.max(0, Math.ceil((Date.parse(endsAt) - now) / 1000));
}

// The sprint's clock on screen (Q-P2-14). The server holds the real clock; at zero
// this submits the page's Finish form so the results come without a tap. Without
// script, the next request finds the sprint over.
export function Countdown({
  endsAt,
  finishForm,
}: {
  endsAt: string;
  // Null: show the clock only (the feedback view finishes from its next page).
  finishForm: string | null;
}) {
  const [left, setLeft] = useState(() => secondsLeft(endsAt, Date.now()));
  useEffect(() => {
    let done = false;
    const tick = () => {
      const now = secondsLeft(endsAt, Date.now());
      setLeft(now);
      if (now === 0 && !done && finishForm !== null) {
        done = true;
        const form = document.getElementById(finishForm);
        if (form instanceof HTMLFormElement) form.requestSubmit();
      }
    };
    tick();
    const timer = setInterval(tick, 250);
    return () => {
      clearInterval(timer);
    };
  }, [endsAt, finishForm]);
  return (
    <div>
      <div
        role="progressbar"
        aria-label="Time left"
        aria-valuemin={0}
        aria-valuemax={QUIZ_SECONDS}
        aria-valuenow={left}
        className="h-1.5 overflow-hidden rounded-full bg-track"
      >
        <div
          className={`h-full rounded-full ${left <= 10 ? "bg-wrong" : "bg-ink"}`}
          style={{ width: `${String((left / QUIZ_SECONDS) * 100)}%` }}
        />
      </div>
      <p className="mt-1 text-right text-xs text-ink-muted tabular-nums">
        {left}s left
      </p>
    </div>
  );
}
