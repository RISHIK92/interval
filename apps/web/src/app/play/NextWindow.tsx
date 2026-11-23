"use client";

import { useEffect, useState } from "react";

// The ranked window's start in the player's own time zone and the time left until it,
// ticking. Both depend on the browser's clock and zone, so they appear once mounted
// (the server's would differ and break hydration).
export function NextWindow({
  at,
  label,
  title,
  body,
}: {
  at: string;
  label: string;
  title: string;
  body: string;
}) {
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
  const start = new Date(at);
  const when =
    now === null
      ? ""
      : start.toLocaleString(undefined, {
          weekday: "long",
          hour: "numeric",
          minute: "2-digit",
        });
  const left = now === null ? null : Math.max(0, start.getTime() - now);
  return (
    <>
      <div className="min-w-56 flex-1">
        <p className="text-[13px] font-medium text-ink-muted">{label}</p>
        <p className="mt-0.5 text-title">
          {title} {when}
        </p>
        <p className="mt-1 text-sm text-ink-muted">{body}</p>
      </div>
      <p className="text-right">
        <span className="block text-[30px] leading-none font-bold tracking-[-0.02em] tabular-nums">
          {left === null ? " " : left === 0 ? "On now" : clock(left)}
        </span>
        <span className="mt-1 block text-[13px] text-ink-muted">
          {left === 0 ? "the window is live" : "until it starts"}
        </span>
      </p>
    </>
  );
}

function clock(ms: number): string {
  const s = Math.floor(ms / 1000);
  const two = (n: number) => String(n).padStart(2, "0");
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0
    ? `${String(h)}:${two(m)}:${two(s % 60)}`
    : `${String(m)}:${two(s % 60)}`;
}
