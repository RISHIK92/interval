"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { BattleReview } from "../../../../../server/ports";
import { AutoRefresh } from "./AutoRefresh";

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
  const [busy, setBusy] = useState(false);
  const post = async (path: string, body?: unknown) => {
    setNotice(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/battle/${props.matchId}/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });
      if (!res.ok) setNotice("That didn't go through. Try again later.");
    } catch (error) {
      console.error("battle: result action failed", error);
      setNotice("That didn't go through. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
    router.refresh();
  };
  return (
    <>
      {props.review?.status === "pending" ? (
        <AutoRefresh everyMs={REVIEW_REFRESH_MS} />
      ) : null}
      <ResultActionsView
        {...props}
        busy={busy}
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
    </>
  );
}

const REVIEW_REFRESH_MS = 5_000;

export function ResultActionsView({
  hasBest,
  review,
  disputed,
  disputeOpen,
  busy = false,
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
  busy?: boolean; // a request is out
  reason: string;
  notice: string | null;
  onReason: (reason: string) => void;
  onReview: () => void;
  onDispute: () => void;
}) {
  return (
    <div className="flex flex-col gap-6 lg:gap-3">
      <section
        aria-label="Code review"
        className="flex flex-col gap-2 lg:rounded-[20px] lg:border-[1.5px] lg:border-dashed lg:border-track lg:px-[18px] lg:py-4"
      >
        <h2 className="flex items-center justify-between gap-3 text-title lg:text-[15px] lg:font-semibold lg:tracking-normal">
          Code review
          <span className="rounded-md bg-well px-1.5 py-0.5 text-xs font-semibold tracking-normal text-ink-muted">
            AI review
          </span>
        </h2>
        {!hasBest ? (
          <p className="text-sm text-ink-muted">
            You didn&apos;t submit, so there&apos;s nothing to review.
          </p>
        ) : review === null ? (
          <>
            <p className="text-sm text-ink-muted">
              An AI review of your best submission: what holds up and what to
              change. It doesn&apos;t affect your rating.
            </p>
            <button
              type="button"
              onClick={onReview}
              disabled={busy}
              className="self-start rounded-md border border-hairline px-3 py-1 disabled:opacity-50 lg:h-10 lg:rounded-xl lg:border-[1.5px] lg:border-hairline-strong lg:px-3.5 lg:text-sm lg:font-semibold"
            >
              {busy ? "Asking…" : "Review my best submission (AI)"}
            </button>
          </>
        ) : review.status === "pending" ? (
          <p
            role="status"
            className="flex items-center gap-2 text-sm text-ink-muted"
          >
            <span
              aria-hidden="true"
              className="size-3.5 rounded-full border-2 border-track border-t-ink motion-safe:animate-spin"
            />
            Being written. It shows here by itself in a minute or so.
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
            <p className="mt-1 whitespace-pre-wrap text-sm lg:mt-2 lg:text-[15px] lg:leading-[1.55] lg:text-ink-muted">
              {review.review}
            </p>
          </div>
        )}
      </section>
      <section
        aria-label="Dispute"
        className="flex flex-col gap-2 lg:rounded-[20px] lg:border lg:border-hairline lg:px-[18px] lg:py-4"
      >
        <h2 className="text-title lg:text-[15px] lg:font-semibold lg:tracking-normal">
          Something wrong with this result?
        </h2>
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
              placeholder="What looks wrong? A test that should have passed, a time, a player…"
              rows={3}
              className="rounded-md border border-hairline bg-page p-2 text-sm lg:rounded-xl lg:px-3"
            />
            <button
              type="submit"
              disabled={busy || reason.trim() === ""}
              className="self-start rounded-md border border-hairline px-3 py-1 disabled:opacity-50 lg:h-10 lg:rounded-xl lg:border-[1.5px] lg:border-track lg:px-3.5 lg:text-sm lg:font-semibold"
            >
              Dispute this result
            </button>
          </form>
        )}
      </section>
      {notice !== null && (
        <p role="alert" className="rounded-2xl bg-well px-4 py-3 text-sm">
          {notice}
        </p>
      )}
    </div>
  );
}
