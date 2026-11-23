"use client";

import { useEffect, useState } from "react";

// A replay's timeline, for LLD and HLD alike: play and pause, and a slider through the
// saved moments (arrow keys step it) with the time since the start under it.
const STEP_MS = 800;

// Milliseconds as m:ss.
export function elapsed(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${String(Math.floor(s / 60))}:${String(s % 60).padStart(2, "0")}`;
}

export function Timeline({
  count,
  at,
  onAt,
  labelOf,
  name,
}: {
  count: number; // the moments saved
  at: number;
  onAt: (at: number) => void;
  labelOf: (at: number) => string; // a moment's time, as "3:20"
  name: string; // the slider's accessible name
}) {
  const [playing, setPlaying] = useState(false);
  const last = Math.max(0, count - 1);
  useEffect(() => {
    if (!playing) return;
    const timer = setTimeout(() => {
      const next = Math.min(last, at + 1);
      onAt(next);
      if (next >= last) setPlaying(false);
    }, STEP_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [playing, at, last, onAt]);
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-well px-3 py-2.5">
      <button
        type="button"
        aria-label={playing ? "Pause" : "Play"}
        disabled={count < 2}
        onClick={() => {
          if (!playing && at >= last) onAt(0);
          setPlaying(!playing);
        }}
        className="flex size-9 shrink-0 items-center justify-center rounded-full bg-ink text-page focus-visible:ring-2 focus-visible:ring-select focus-visible:outline-none disabled:opacity-40"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" className="size-3.5">
          {playing ? (
            <path d="M6 4h4v16H6zM14 4h4v16h-4z" fill="currentColor" />
          ) : (
            <path d="M7 4.5v15l12-7.5z" fill="currentColor" />
          )}
        </svg>
      </button>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <input
          type="range"
          min={0}
          max={last}
          value={at}
          disabled={count < 2}
          aria-label={name}
          aria-valuetext={`${labelOf(at)}, moment ${String(at + 1)} of ${String(count)}`}
          onChange={(e) => {
            setPlaying(false);
            onAt(Number(e.target.value));
          }}
          className="w-full accent-ink"
        />
        <p className="flex justify-between gap-2 text-xs text-ink-muted tabular-nums">
          <span>{labelOf(0)}</span>
          <span className="font-semibold text-ink">
            {labelOf(at)} · {at + 1} of {count}
          </span>
          <span>{labelOf(last)}</span>
        </p>
      </div>
    </div>
  );
}
