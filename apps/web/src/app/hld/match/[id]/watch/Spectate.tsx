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
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (state.over) {
      router.push(`/hld/match/${matchId}/replay`);
      return;
    }
    const timer = setInterval(() => {
      setNow(Date.now());
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
  const left = Math.max(0, new Date(state.deadline).getTime() - now);
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-ink-muted">
        About {Math.ceil(left / 60_000)} minutes left. Designs update as they
        autosave.
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
