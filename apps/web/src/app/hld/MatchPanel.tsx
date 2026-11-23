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
  // Set once mounted: the server's clock would differ and break hydration (Clock.tsx).
  const [now, setNow] = useState<number | null>(null);
  const [submitted, setSubmitted] = useState(wasSubmitted);
  const [said, setSaid] = useState<string | null>(null);
  const left =
    now === null ? null : Math.max(0, new Date(deadline).getTime() - now);

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

  // Asking moves the match on (ADR-0043): it closes at the deadline, and its results
  // open once it's over for everyone.
  useEffect(() => {
    if (!submitted && (left === null || left > 0)) return;
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

  return (
    <section
      className="flex flex-col gap-2 rounded-3xl border border-hairline bg-card p-5 lg:mt-auto lg:bg-transparent lg:rounded-none lg:border-0 lg:p-0 lg:pt-4"
      aria-live="polite"
    >
      {/* On a desktop the clock is in the page's header (Clock.tsx). */}
      <h2 className="text-title lg:hidden">
        {left === null
          ? "\u00a0"
          : `${String(Math.floor(left / 60_000))}:${String(Math.floor((left % 60_000) / 1_000)).padStart(2, "0")} left`}
      </h2>
      {submitted ? (
        <p className="text-sm lg:rounded-xl lg:bg-well lg:px-3 lg:py-3 lg:font-medium">
          Submitted. Waiting for the others and the judge…
        </p>
      ) : (
        <button
          type="button"
          disabled={!ready || left === 0}
          className="self-start rounded-full bg-ink px-5 py-2.5 font-semibold text-page disabled:opacity-50 lg:h-12 lg:self-stretch lg:rounded-xl lg:px-4 lg:text-[15px]"
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
      {said === null ? null : <p className="text-sm lg:text-wrong">{said}</p>}
      <p className="text-xs text-ink-muted lg:order-first lg:text-[13px]">
        {/* On a desktop the canvas shows the weights as a bar. */}
        <span className="lg:hidden">
          Simulation 60, the AI rubric 25 (only if the baseline passes), speed
          15.{" "}
        </span>
        <span className="hidden lg:inline">
          The AI rubric counts only if the baseline passes.{" "}
        </span>
        At the deadline your last autosave is submitted for you.
      </p>
    </section>
  );
}
