"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

// P6-W42 (Q-P6-06, ADR-0043): while the AI judge works (up to 15 minutes), ask now and
// then, which moves the match on, and show the results once it's scored.
const POLL_MS = 5_000;

export function Waiting({ matchId }: { matchId: string }) {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => {
      fetch(`/api/hld/match/${matchId}`)
        .then(async (r) => {
          const { phase } = (await r.json()) as { phase: string };
          if (phase === "scored") router.refresh();
        })
        .catch((e: unknown) => {
          console.error("HLD match state not read", e);
        });
    }, POLL_MS);
    return () => {
      clearInterval(timer);
    };
  }, [matchId, router]);
  return (
    <p role="status" className="text-ink-muted">
      Scoring: the simulation is done, and the AI judge is grading each design.
      This takes up to 15 minutes.
    </p>
  );
}
