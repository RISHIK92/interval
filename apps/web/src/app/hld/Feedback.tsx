"use client";

import { type Design, LEVELS, RUBRIC_POINTS } from "@interval/hld";
import { useEffect, useState } from "react";
import type { FeedbackView } from "./practice/feedback";

// P6-W41 (CANVAS-6, AI-3, §6.4; Q-P6-05): the AI judge's rubric levels and the coach's
// advice on the design as it was when asked, labelled AI; and one appeal. The worker
// writes them; this asks again every few seconds while they're pending.

const POLL_MS = 3_000;
const LEVEL_NAMES = [
  "missing",
  "mentioned",
  "reasoned",
  "sound trade-off",
  "excellent",
];
const REFUSED: Record<string, string> = {
  twice: "This feedback has been appealed already.",
  late: "Appeals close 7 days after the feedback was asked for.",
  not_judged: "Only graded feedback can be appealed.",
};

export function Feedback({
  ask,
  initial,
}: {
  // Practice asks for feedback on the design as it stands; a match's results only show
  // the feedback its submission got.
  ask: { slug: string; design: Design; ready: boolean } | null;
  initial: FeedbackView | null;
}) {
  const [view, setView] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const pending = view?.status === "pending";

  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(() => {
      fetch(`/api/hld/judgements/${view.id}`)
        .then(async (r) => {
          if (!r.ok) throw new Error(String(r.status));
          setView((await r.json()) as FeedbackView);
        })
        .catch((e: unknown) => {
          console.error("HLD feedback not read", e);
          setError("Couldn't check on the feedback. Reload to try again.");
        });
    }, POLL_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [pending, view]);

  const request = async () => {
    if (ask === null) return;
    setError(null);
    const r = await fetch(`/api/hld/practice/${ask.slug}/feedback`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(ask.design),
    });
    if (!r.ok) {
      setError("Couldn't ask for feedback. Check the design and try again.");
      return;
    }
    const { id } = (await r.json()) as { id: string };
    setView({
      id,
      status: "pending",
      baselinePassed: true,
      criteria: [],
      rubricPoints: null,
      coach: null,
      appealed: false,
      regraded: false,
    });
  };

  const appeal = async () => {
    if (view === null) return;
    const r = await fetch(`/api/hld/judgements/${view.id}/appeal`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason }),
    });
    if (r.ok) setView({ ...view, appealed: true });
    else {
      const body = (await r.json().catch(() => ({}))) as { refused?: string };
      setError(REFUSED[body.refused ?? ""] ?? "Couldn't send the appeal.");
    }
  };

  return (
    <section
      className="flex flex-col gap-2 rounded-md border border-line p-3 lg:mt-auto lg:rounded-[14px] lg:border-[1.5px] lg:border-dashed lg:border-hairline"
      aria-live="polite"
    >
      <h2 className="text-title lg:flex lg:items-center lg:justify-between lg:text-[15px] lg:font-semibold lg:tracking-normal">
        Feedback{" "}
        <span className="text-xs text-ink-muted lg:rounded-full lg:bg-well lg:px-2 lg:py-0.5 lg:text-[11px] lg:font-semibold">
          AI
        </span>
      </h2>
      {ask === null ? null : (
        <button
          type="button"
          disabled={!ask.ready || pending}
          className="self-start rounded-md border border-line px-2 py-1 text-sm disabled:opacity-50 lg:order-last lg:mt-2 lg:h-12 lg:self-stretch lg:rounded-xl lg:border-0 lg:bg-ink lg:px-4 lg:text-[15px] lg:font-semibold lg:text-page"
          onClick={() => {
            void request();
          }}
        >
          {pending ? "Asking…" : "Get AI feedback"}
        </button>
      )}
      {error !== null ? <p className="text-sm">{error}</p> : null}
      {view === null || pending ? null : view.status === "unavailable" ? (
        <p className="text-sm text-ink-muted">
          Feedback couldn&apos;t be written this time (the AI budget may be
          spent). Try again later.
        </p>
      ) : (
        <>
          <p className="text-xs text-ink-muted">
            Written by AI about the design as it was when you asked. It never
            affects a rating.
          </p>
          {!view.baselinePassed ? (
            <p className="text-sm">
              No rubric points: the design doesn&apos;t pass the baseline
              scenario.
            </p>
          ) : view.rubricPoints === null ? (
            <p className="text-sm text-ink-muted">
              The judge couldn&apos;t grade this design; the coach&apos;s advice
              is below.
            </p>
          ) : (
            <>
              <p>
                {view.rubricPoints} of {RUBRIC_POINTS} rubric points
                {view.regraded ? " (re-graded by a person on appeal)" : ""}
              </p>
              <ul className="flex flex-col gap-1 text-sm">
                {view.criteria.map((c) => (
                  <li key={c.id}>
                    <span className="font-semibold">
                      {c.level === null
                        ? "Not graded"
                        : `${String(c.level)}/${String(LEVELS)} ${LEVEL_NAMES[c.level] ?? ""}`}
                    </span>{" "}
                    · {c.criterion}
                    {c.reason === null ? null : (
                      <span className="block text-ink-muted">{c.reason}</span>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
          {view.coach === null ? null : (
            <p className="whitespace-pre-wrap text-sm">{view.coach}</p>
          )}
          {view.rubricPoints !== null && !view.appealed ? (
            <details className="text-sm">
              <summary>Appeal the grades</summary>
              <textarea
                value={reason}
                maxLength={500}
                rows={3}
                className="mt-1 w-full rounded-md border border-line px-2 py-1"
                aria-label="Why the grades are wrong"
                onChange={(e) => {
                  setReason(e.target.value);
                }}
              />
              <button
                type="button"
                disabled={reason.trim() === ""}
                className="mt-1 rounded-md border border-line px-2 py-1 disabled:opacity-50"
                onClick={() => {
                  void appeal();
                }}
              >
                Send the appeal
              </button>
            </details>
          ) : view.appealed && !view.regraded ? (
            <p className="text-sm text-ink-muted">
              Appealed: a person will re-grade it.
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
