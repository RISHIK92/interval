"use client";

import { useEffect, useState } from "react";
import { z } from "zod";
import type { OpponentProgress as Progress } from "../../../../server/hld-matches";

// Q-WD-14 (owner, 2026-11-23): each opponent's progress in the match header, as the
// design's "RS · 3 of 5 scenarios": how many scenarios their latest autosave passes.
// Asked every 10 seconds until the match is over; then the last count stays.

const POLL_MS = 10_000;

const Answer = z.object({
  total: z.int().min(0),
  opponents: z.array(z.object({ player: z.string(), passed: z.int().min(0) })),
});

// Two letters: the first of a name's first two parts, or its first two letters.
function initials(player: string): string {
  const parts = player.split(/[^\p{L}\p{N}]+/u).filter((p) => p !== "");
  const letters =
    parts.length >= 2
      ? `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`
      : (parts[0] ?? player).slice(0, 2);
  return letters.toUpperCase();
}

export function OpponentProgress({
  matchId,
  initial,
}: {
  matchId: string;
  initial: Progress;
}) {
  const [progress, setProgress] = useState(initial);
  const solo = initial.opponents.length === 0;

  useEffect(() => {
    if (solo) return;
    const poll = setInterval(() => {
      fetch(`/api/hld/match/${matchId}/progress`)
        .then(async (r) => {
          // Over (409), or no longer ours to see: nothing more is live.
          if (r.status === 409 || r.status === 401 || r.status === 403) {
            clearInterval(poll);
            return;
          }
          if (!r.ok) throw new Error(String(r.status));
          setProgress(Answer.parse(await r.json()));
        })
        .catch((e: unknown) => {
          console.error("HLD opponent progress not read", e);
        });
    }, POLL_MS);
    return () => {
      clearInterval(poll);
    };
  }, [matchId, solo]);

  if (solo) return null;
  return (
    <ul
      aria-live="polite"
      aria-label="Opponents' progress"
      className="mt-2 flex flex-wrap gap-2 lg:mt-0"
    >
      {progress.opponents.map((o, i) => (
        <li
          key={`${String(i)}:${o.player}`}
          title={o.player}
          className="flex h-[38px] items-center rounded-full bg-well px-3 text-sm whitespace-nowrap text-ink-muted tabular-nums"
        >
          <span aria-hidden="true" className="font-semibold text-ink">
            {initials(o.player)}
          </span>
          <span className="sr-only">{o.player}</span>
          <span>
            {` · ${String(o.passed)} of ${String(progress.total)} scenarios`}
          </span>
        </li>
      ))}
    </ul>
  );
}
