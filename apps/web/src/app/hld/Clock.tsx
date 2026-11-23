"use client";

import { useEffect, useState } from "react";

// The web design's header clock for an HLD match. Display only: MatchPanel keeps its
// own count for the submission and the move to the results.
export function Clock({ deadline }: { deadline: string }) {
  // Set once mounted: the server's clock would differ and break hydration.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => {
      setNow(Date.now());
    };
    tick();
    const timer = setInterval(tick, 1_000);
    return () => {
      clearInterval(timer);
    };
  }, []);
  const left =
    now === null ? null : Math.max(0, new Date(deadline).getTime() - now);
  const minutes = left === null ? 0 : Math.floor(left / 60_000);
  const seconds = left === null ? 0 : Math.floor((left % 60_000) / 1_000);
  return (
    <span
      role="timer"
      aria-label={
        left === null
          ? "Time left"
          : `${String(minutes)} minutes ${String(seconds)} seconds left`
      }
      className="hidden h-[38px] items-center gap-2 rounded-full bg-ink px-3.5 text-[17px] font-bold text-page tabular-nums lg:flex"
    >
      <ClockIcon />
      {left === null
        ? null
        : `${String(minutes)}:${String(seconds).padStart(2, "0")}`}
    </span>
  );
}

export function ClockIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="13" r="8" />
      <path d="M12 9v4l2.5 2M10 2h4" />
    </svg>
  );
}
