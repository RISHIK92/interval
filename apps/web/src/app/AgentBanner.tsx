"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const minutes = (ms: number) => Math.max(0, Math.floor(ms / 60_000));

// P3-W17-S04 (§7, C-10, Q-P3-28): while a coding agent runs, how long it has run (never
// a time left: the hook sends no duration); after it finished, the way back to where the
// player was.
export function AgentBanner({
  startedAt,
  place,
  now: firstNow,
}: {
  startedAt: number | null;
  place: string | null;
  now: number; // the server's clock at render, so the first paint agrees
}) {
  const [now, setNow] = useState(firstNow);
  useEffect(() => {
    if (startedAt === null) return;
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 15_000);
    return () => {
      clearInterval(timer);
    };
  }, [startedAt]);
  if (startedAt === null && place === null) return null;
  return (
    <div className="flex flex-col gap-2">
      {startedAt === null ? null : (
        // No live region: a count changing each minute would be read out each time.
        <p className="rounded-2xl bg-well px-4 py-3 text-sm font-semibold tabular-nums">
          Agent running · {minutes(now - startedAt)} min
        </p>
      )}
      {place === null ? null : (
        <Link
          href={place}
          className="rounded-2xl border border-hairline px-4 py-3 text-sm font-semibold"
        >
          Pick up where you left off →
        </Link>
      )}
    </div>
  );
}
