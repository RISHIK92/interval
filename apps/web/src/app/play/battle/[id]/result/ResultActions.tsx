"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { BattleReview } from "../../../../../server/ports";

// P5-W35 (§6.5, AI-1; Q-P5-14, Q-P5-22): the AI code review of the player's best
// submission, on request and labelled AI, never touching ratings; and a dispute of the
// result, once, within 7 days.
export function ResultActions(props: {
  matchId: string;
  hasBest: boolean;
  review: BattleReview | null;
  disputed: boolean;
  disputeOpen: boolean;
}) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const post = async (path: string, body?: unknown) => {
    setNotice(null);
    const res = await fetch(`/api/battle/${props.matchId}/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    if (!res.ok) setNotice("That didn't go through. Try again later.");
    router.refresh();
  };
  return (
    <ResultActionsView
      {...props}
      reason={reason}
      notice={notice}
      onReason={setReason}
      onReview={() => {
        void post("review");
      }}
      onDispute={() => {
        void post("dispute", { reason });
      }}
    />
  );
}

export function ResultActionsView({
  hasBest,
  review,
  disputed,
  disputeOpen,
  reason,
  notice,
  onReason,
  onReview,
  onDispute,
}: {
  hasBest: boolean;
  review: BattleReview | null;
  disputed: boolean;
  disputeOpen: boolean;
  reason: string;
  notice: string | null;
  onReason: (reason: string) => void;
  onReview: () => void;
  onDispute: () => void;
}) {
  return (
    <div className="flex flex-col gap-6">
      <section aria-label="Code review" className="flex flex-col gap-2">
        <h2 className="text-title">Code review</h2>
        {!hasBest ? (
          <p className="text-sm text-ink-muted">
            You didn&apos;t submit, so there&apos;s nothing to review.
          </p>
        ) : review === null ? (
          <button
            type="button"
            onClick={onReview}
            className="self-start rounded-md border border-line px-3 py-1"
          >
            Review my best submission (AI)
          </button>
        ) : review.status === "pending" ? (
          <p className="text-sm text-ink-muted">
            Being written. Reload in a minute.
          </p>
        ) : review.status === "unavailable" ? (
          <p className="text-sm text-ink-muted">
            The review couldn&apos;t be written this time.
          </p>
        ) : (
          <div>
            <p className="text-xs text-ink-muted">
              <span className="mr-1 rounded bg-well px-1">AI</span>
              Written by AI from your best submission. It doesn&apos;t affect
              your rating.
            </p>
            <p className="mt-1 whitespace-pre-wrap text-sm">{review.review}</p>
          </div>
        )}
      </section>
      <section aria-label="Dispute" className="flex flex-col gap-2">
        <h2 className="text-title">Something wrong?</h2>
        {disputed ? (
          <p className="text-sm text-ink-muted">
            You disputed this result. We&apos;ll look at it.
          </p>
        ) : !disputeOpen ? (
          <p className="text-sm text-ink-muted">
            Results can be disputed for 7 days.
          </p>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              onDispute();
            }}
            className="flex flex-col gap-2"
          >
            <textarea
              value={reason}
              maxLength={1000}
              onChange={(e) => {
                onReason(e.target.value);
              }}
              aria-label="What's wrong with this result"
              className="rounded-md border border-line p-2 text-sm"
            />
            <button
              type="submit"
              disabled={reason.trim() === ""}
              className="self-start rounded-md border border-line px-3 py-1 disabled:opacity-50"
            >
              Dispute this result
            </button>
          </form>
        )}
      </section>
      {notice !== null && (
        <p role="status" className="text-sm text-ink-muted">
          {notice}
        </p>
      )}
    </div>
  );
}
