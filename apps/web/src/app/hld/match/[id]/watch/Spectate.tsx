"use client";

import type { HldProblem } from "@interval/hld";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { DesignView } from "../../../DesignView";

// P6-W44 (§6.4, Q-P6-08): a tournament match as it's played: each side's latest
// autosave, asked for every few seconds; once over, the replay.
const POLL_MS = 5_000;

type Watched = {
  over: boolean;
  deadline: string;
  seats: {
    player: string;
    submitted: boolean;
    total: number | null;
    design: unknown;
  }[];
};

export function Spectate({
  matchId,
  problem,
  initial,
}: {
  matchId: string;
  problem: HldProblem;
  initial: Watched;
}) {
  const router = useRouter();
  const [state, setState] = useState(initial);
  // Set once mounted: the server's clock would differ and break hydration (Clock.tsx).
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => {
      setNow(Date.now());
    };
    tick();
    const timer = setInterval(tick, POLL_MS);
    return () => {
      clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    if (state.over) {
      router.push(`/hld/match/${matchId}/replay`);
      return;
    }
    const timer = setInterval(() => {
      fetch(`/api/hld/match/${matchId}/watch`)
        .then(async (r) => {
          if (r.ok) setState((await r.json()) as Watched);
          else console.error("HLD spectate refused", r.status); // access lost
        })
        .catch((e: unknown) => {
          console.error("HLD spectate failed", e);
        });
    }, POLL_MS);
    return () => {
      clearInterval(timer);
    };
  }, [state.over, matchId, router]);
  const left =
    now === null ? null : Math.max(0, new Date(state.deadline).getTime() - now);
  return (
    <div className="flex flex-col gap-4">
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-muted">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-live/15 px-2.5 py-1 text-xs font-semibold text-live">
          <span
            aria-hidden="true"
            className="size-1.5 rounded-full bg-live motion-safe:animate-pulse"
          />
          Live
        </span>
        {left === null ? null : (
          <span className="font-semibold text-ink tabular-nums">
            {left === 0
              ? "Time's up: scoring next"
              : `About ${String(Math.ceil(left / 60_000))} min left`}
          </span>
        )}
        <span>Designs update as the players autosave.</span>
      </p>
      <div className="grid gap-4 lg:grid-cols-2">
        {state.seats.map((s) => (
          <DesignView
            key={s.player}
            problem={problem}
            design={s.design}
            title={`${s.player}${s.submitted ? " (submitted)" : ""}`}
          />
        ))}
      </div>
    </div>
  );
}
