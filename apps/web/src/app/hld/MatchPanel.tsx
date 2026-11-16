"use client";

import type { Design } from "@interval/hld";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

// P6-W42 (§6.4, Q-P6-06): a match's clock and its one submission. Submitting early
// earns speed points if the design passes the baseline; at the deadline the last
// autosave is submitted for you. Once the match is over, its results open.

const POLL_MS = 5_000;
const SAID: Record<string, string> = {
  already: "You've already submitted.",
  closed: "The match is over.",
  invalid: "The design isn't valid for this problem yet.",
  "signed-out": "Sign in again to submit.",
  forbidden: "HLD battles aren't on your plan.",
};

export function MatchPanel({
  matchId,
  deadline,
  submitted: wasSubmitted,
  design,
  ready,
}: {
  matchId: string;
  deadline: string;
  submitted: boolean;
  design: Design;
  ready: boolean;
}) {
  const router = useRouter();
  const [now, setNow] = useState(() => Date.now());
  const [submitted, setSubmitted] = useState(wasSubmitted);
  const [said, setSaid] = useState<string | null>(null);
  const left = Math.max(0, new Date(deadline).getTime() - now);

  useEffect(() => {
    const tick = setInterval(() => {
      setNow(Date.now());
    }, 1_000);
    return () => {
      clearInterval(tick);
    };
  }, []);

  // Asking moves the match on (ADR-0043): it closes at the deadline, and its results
  // open once it's over for everyone.
  useEffect(() => {
    if (!submitted && left > 0) return;
    const poll = setInterval(() => {
      fetch(`/api/hld/match/${matchId}`)
        .then(async (r) => {
          const state = (await r.json()) as { phase: string };
          if (state.phase !== "playing")
            router.push(`/hld/match/${matchId}/result`);
        })
        .catch((e: unknown) => {
          console.error("HLD match state not read", e);
        });
    }, POLL_MS);
    return () => {
      clearInterval(poll);
    };
  }, [submitted, left, matchId, router]);

  const minutes = Math.floor(left / 60_000);
  const seconds = Math.floor((left % 60_000) / 1_000);
  return (
    <section
      className="flex flex-col gap-2 rounded-md border border-line p-3"
      aria-live="polite"
    >
      <h2 className="text-title">
        {String(minutes)}:{String(seconds).padStart(2, "0")} left
      </h2>
      {submitted ? (
        <p className="text-sm">
          Submitted. Waiting for the others and the judge…
        </p>
      ) : (
        <button
          type="button"
          disabled={!ready || left === 0}
          className="self-start rounded-md border border-line px-2 py-1 text-sm disabled:opacity-50"
          onClick={() => {
            void fetch(`/api/hld/match/${matchId}/submit`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ design }),
            })
              .then(async (res) => {
                if (res.status === 401 || res.status === 403)
                  return "signed-out";
                // 200 and 409 carry the result; anything else is a refusal or an error.
                if (res.status !== 200 && res.status !== 409) return "invalid";
                const body = (await res.json()) as { result?: unknown };
                return typeof body.result === "string"
                  ? body.result
                  : "invalid";
              })
              .then((r) => {
                if (r === "submitted" || r === "already") {
                  setSubmitted(true);
                  router.refresh(); // the canvas stops saving once submitted
                } else setSaid(SAID[r] ?? "Couldn't submit.");
              })
              .catch((error: unknown) => {
                console.error("HLD submit failed", error);
                setSaid(
                  "Couldn't submit. Check your connection and try again.",
                );
              });
          }}
        >
          Submit the design
        </button>
      )}
      {said === null ? null : <p className="text-sm">{said}</p>}
      <p className="text-xs text-ink-muted">
        Simulation 60, the AI rubric 25 (only if the baseline passes), speed 15.
        At the deadline your last autosave is submitted for you.
      </p>
    </section>
  );
}
