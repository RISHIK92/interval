"use client";

import type { Design } from "@interval/hld";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

// P6-W42 (§6.4, Q-P6-06): a match's clock and its one submission. Submitting early
// earns speed points if the design passes the baseline; at the deadline the last
// autosave is submitted for you. Once the match is over, its results open. ADR-0060:
// the submission's verdicts show on the canvas once it's in (`onSubmitted`).

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
  onSubmitted,
}: {
  matchId: string;
  deadline: string;
  submitted: boolean;
  design: Design;
  ready: boolean;
  onSubmitted: (design: Design) => void;
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
                  // Already: another tab's submission, which the refresh brings in.
                  if (r === "submitted") onSubmitted(design);
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

// Q-WD-16: the match header's way out (the design's ×). Leaving doesn't forfeit: it asks
// first, since the last autosave is still submitted at the deadline.
export function LeaveMatch() {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button
        type="button"
        aria-label="Leave the match"
        className="hidden size-11 shrink-0 items-center justify-center rounded-xl border-[1.5px] border-hairline-strong text-ink hover:bg-well focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-select lg:flex"
        onClick={() => {
          dialog.current?.showModal();
        }}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>
      <dialog
        ref={dialog}
        aria-labelledby="leave-match-title"
        className="m-auto w-[min(26rem,calc(100%-2rem))] rounded-3xl border border-hairline bg-card p-6 text-ink backdrop:bg-black/40"
      >
        <h2 id="leave-match-title" className="text-[19px] font-bold">
          Leave the match?
        </h2>
        <p className="mt-2 text-sm text-ink-soft">
          Your last autosave is submitted at the deadline.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            autoFocus
            className="h-11 rounded-xl border-[1.5px] border-hairline-strong px-4 text-[15px] font-semibold hover:bg-well"
            onClick={() => {
              dialog.current?.close();
            }}
          >
            Stay
          </button>
          <button
            type="button"
            className="h-11 rounded-xl bg-ink px-4 text-[15px] font-semibold text-page"
            onClick={() => {
              dialog.current?.close();
              router.push("/hld/play");
            }}
          >
            Leave
          </button>
        </div>
      </dialog>
    </>
  );
}
