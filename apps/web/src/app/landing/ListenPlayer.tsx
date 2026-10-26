"use client";

import Link from "next/link";
import { useState } from "react";

// The Listen demo's waveform; play/pause only stops the bars (there's no audio).
const BARS = Array.from({ length: 44 }, (_, i) => ({
  height: `${String(12 + ((i * 37) % 44))}px`,
  background: i < 17 ? "var(--ink)" : "var(--ln2)",
  animationDuration: `${String(0.8 + (i % 5) * 0.14)}s`,
  animationDelay: `${String(-i * 0.07)}s`,
}));

export function ListenPlayer() {
  const [playing, setPlaying] = useState(true);
  const playLabel = playing ? "Pause" : "Play";
  const togglePlay = () => {
    setPlaying((p) => !p);
  };
  const playState = playing ? "running" : "paused";
  return (
    <div className="rv2 flex-[1_1_540px] min-w-0 rounded-[28px] bg-(--card) [border:1px_solid_var(--ln)] [box-shadow:var(--shadow)] p-[22px] flex flex-col gap-[18px]">
      <div className="flex items-center gap-[14px]">
        <span className="w-[64px] h-[64px] rounded-[16px] bg-(--dbT) flex items-center justify-center flex-none">
          <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden="true">
            <path
              className="[fill:var(--dbM)]"
              d="M6 10v20a14 5 0 0 0 28 0V10z"
            />
            <path
              className="[fill:none] [stroke:var(--dbS)] [stroke-width:2.5]"
              d="M6 20a14 5 0 0 0 28 0"
            />
            <ellipse
              className="[fill:var(--dbL)]"
              cx="20"
              cy="10"
              rx="14"
              ry="5"
            />
          </svg>
        </span>
        <span className="flex-1 min-w-0 flex flex-col gap-[2px]">
          <span className="text-[18px] font-bold tracking-[-0.015em]">
            Why your connection pool runs dry
          </span>
          <span className="text-[14px] text-(--ink3)">
            Postgres Weekly · 6 min episode
          </span>
        </span>
      </div>
      <div className="h-[64px] flex items-center gap-[3px]" aria-hidden="true">
        {BARS.map((st, i) => (
          <span
            key={i}
            className="flex-1 max-w-[6px] rounded-[3px] [animation:lp-wave_1s_ease-in-out_infinite]"
            style={{ ...st, animationPlayState: playState }}
          ></span>
        ))}
      </div>
      <div className="flex flex-col gap-[6px]">
        <div
          className="relative h-[6px] rounded-[3px] bg-(--sf2)"
          aria-hidden="true"
        >
          <span className="absolute left-0 top-0 bottom-0 w-[38%] rounded-[3px] bg-(--ink)"></span>
          <span className="pulse absolute left-[38%] top-[-5px] w-[16px] h-[16px] ml-[-8px] rounded-[99px] bg-(--ink)"></span>
          <span className="absolute left-[35%] top-[-3px] w-[2px] h-[12px] bg-(--ink3)"></span>
          <span className="absolute left-[70%] top-[-3px] w-[2px] h-[12px] bg-(--ink3)"></span>
        </div>
        <div className="n flex justify-between text-[13px] text-(--ink3)">
          <span>2:17 · Timeouts</span>
          <span>Queues · 6:02</span>
        </div>
      </div>
      <div className="flex items-center gap-[10px] flex-wrap">
        <span
          className="w-[44px] h-[44px] rounded-[99px] [border:1.5px_solid_var(--ln)] flex items-center justify-center"
          aria-hidden="true"
        >
          <svg
            className="i"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5" />
          </svg>
        </span>
        <button
          className="w-[60px] h-[60px] rounded-[99px] border-0 bg-(--act) text-(--onact) flex items-center justify-center p-0"
          type="button"
          aria-label={playLabel}
          onClick={togglePlay}
        >
          {playing && (
            <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
              <path
                className="[fill:currentColor]"
                d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"
              />
            </svg>
          )}
          {!playing && (
            <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
              <path className="[fill:currentColor]" d="M7 4.5v15l12-7.5z" />
            </svg>
          )}
        </button>
        <span
          className="w-[44px] h-[44px] rounded-[99px] [border:1.5px_solid_var(--ln)] flex items-center justify-center"
          aria-hidden="true"
        >
          <svg
            className="i"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path d="M21 12a9 9 0 1 1-3-6.7M21 4v5h-5" />
          </svg>
        </span>
        <span className="n h-[32px] p-[0_12px] rounded-[99px] bg-(--sf) flex items-center text-[14px] font-semibold">
          1.2×
        </span>
        <Link
          href="/join"
          className="ml-auto h-[44px] p-[0_16px] rounded-[999px] [border:1.5px_solid_var(--ln2)] flex items-center gap-[8px] text-[15px] font-semibold no-underline"
        >
          <svg
            className="i"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path d="M6 3h12v18l-6-4-6 4z" />
          </svg>
          Save this moment
        </Link>
      </div>
      <div className="rounded-[16px] bg-(--sf) p-[14px_16px] text-[17px] leading-[1.6]">
        <span className="rounded-[6px] p-[1px_3px] [animation:lp-hl_9s_linear_infinite]">
          Your pool lends out five connections.
        </span>{" "}
        <span className="rounded-[6px] p-[1px_3px] [animation:lp-hl_9s_linear_-6s_infinite]">
          The other thirty-five requests wait in line.
        </span>{" "}
        <span className="rounded-[6px] p-[1px_3px] [animation:lp-hl_9s_linear_-3s_infinite]">
          Wait long enough, and they time out.
        </span>
      </div>
    </div>
  );
}
