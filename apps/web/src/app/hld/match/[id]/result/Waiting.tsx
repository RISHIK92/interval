"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

// P6-W42 (Q-P6-06, ADR-0043): while the AI judge works (up to 15 minutes), ask now and
// then, which moves the match on, and show the results once it's scored.
const POLL_MS = 5_000;

export function Waiting({ matchId }: { matchId: string }) {
  const router = useRouter();
  const [unreachable, setUnreachable] = useState(false);
  useEffect(() => {
    const timer = setInterval(() => {
      fetch(`/api/hld/match/${matchId}`)
        .then(async (r) => {
          if (!r.ok) throw new Error(String(r.status));
          setUnreachable(false);
          const { phase } = (await r.json()) as { phase: string };
          if (phase === "scored") router.refresh();
        })
        .catch((e: unknown) => {
          console.error("HLD match state not read", e);
          setUnreachable(true);
        });
    }, POLL_MS);
    return () => {
      clearInterval(timer);
    };
  }, [matchId, router]);
  return <WaitingView unreachable={unreachable} />;
}

export function WaitingView({ unreachable }: { unreachable: boolean }) {
  return (
    <section
      role="status"
      aria-label="Scoring"
      className="flex flex-col gap-3 rounded-2xl bg-well px-5 py-4"
    >
      <p className="flex items-center gap-2.5 text-section">
        <span
          aria-hidden="true"
          className="size-4 rounded-full border-2 border-track border-t-ink motion-safe:animate-spin"
        />
        Scoring…
      </p>
      <p className="text-sm text-ink-muted">
        The simulation is done, and the AI judge is grading each design. This
        takes up to 15 minutes; the results open here by themselves, so you can
        leave this page open or come back later.
      </p>
      {unreachable ? (
        <p className="text-sm font-semibold">
          Couldn&apos;t check on the scoring just now. Still trying; reload if
          this stays.
        </p>
      ) : null}
    </section>
  );
}
