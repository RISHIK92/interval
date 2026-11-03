"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { z } from "zod";
import { GAME_MODES, type GameMode } from "../server/ports";
import { liveHref } from "./play/live/href";

// Often enough that an accepted challenge reaches its sender well inside the 60 s the
// match waits; one session read and two Valkey calls each.
const BEAT_MS = 10_000;
const Reply = z.object({
  challenge: z
    .object({ matchId: z.string(), mode: z.enum(GAME_MODES) })
    .nullable(),
  agentFinished: z.boolean(),
});

// P3-W17-S03 (Q-P3-16; owner, 2026-11-03): while a tab is open and in view it tells the
// server every 10 s that its player is around (a challenge link needs its sender
// online), and shows "Join now" when a friend accepts the player's challenge. Signed
// out (401), it stops.
export function Presence() {
  const [accepted, setAccepted] =
    useState<z.infer<typeof Reply>["challenge"]>(null);
  const [agentDone, setAgentDone] = useState(false);
  useEffect(() => {
    let stopped = false;
    let lastPage: string | null = null;
    const beat = async () => {
      if (stopped || document.visibilityState !== "visible") return;
      // The page open: an agent's "finished" saves it as the place (P3-W17-S04).
      const page = `${location.pathname}${location.search}`;
      // A page changed since the last beat is a visit (a saved place opened); the
      // page already open when an agent finishes isn't.
      const arrived = page !== lastPage;
      lastPage = page;
      const response = await fetch("/api/presence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ page, arrived }),
      });
      if (response.status === 401) {
        stopped = true;
        return;
      }
      if (!response.ok) throw new Error(`presence: ${String(response.status)}`);
      const reply = Reply.parse(await response.json());
      // Lapsed (the match waited its minute): the banner goes with it.
      setAccepted(reply.challenge);
      if (reply.agentFinished) setAgentDone(true);
    };
    const run = () => {
      beat().catch((error: unknown) => {
        console.error("presence failed", error);
      });
    };
    run();
    const timer = setInterval(run, BEAT_MS);
    document.addEventListener("visibilitychange", run);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", run);
    };
  }, []);
  return (
    <>
      <AcceptedBanner
        accepted={accepted}
        onDone={() => {
          setAccepted(null);
        }}
      />
      {agentDone ? (
        <AgentFinishedNote
          onDone={() => {
            setAgentDone(false);
          }}
        />
      ) : null}
    </>
  );
}

// P3-W17-S04 (§7, Q-P3-28): the agent finished; the page open is saved as the place.
export function AgentFinishedNote({ onDone }: { onDone: () => void }) {
  return (
    <div
      role="status"
      className="fixed inset-x-4 bottom-24 z-20 mx-auto flex max-w-xl items-center justify-between gap-3 rounded-2xl bg-ink px-4 py-3 text-page shadow-card lg:bottom-6"
    >
      <span className="font-semibold">
        Agent finished · your place is saved
      </span>
      <button
        type="button"
        onClick={onDone}
        aria-label="Dismiss"
        className="cursor-pointer rounded-full px-2 py-1.5 font-semibold"
      >
        ✕
      </button>
    </div>
  );
}

// "Join now" for an accepted challenge, or nothing; dismissible.
export function AcceptedBanner({
  accepted,
  onDone,
}: {
  accepted: { matchId: string; mode: GameMode } | null;
  onDone: () => void;
}) {
  if (accepted === null) return null;
  return (
    <div
      role="alert"
      className="fixed inset-x-4 top-4 z-20 mx-auto flex max-w-xl items-center justify-between gap-3 rounded-2xl bg-ink px-4 py-3 text-page shadow-card"
    >
      <span className="font-semibold">Your friend accepted your challenge</span>
      <span className="flex items-center gap-2">
        <Link
          href={liveHref(accepted.mode, accepted.matchId)}
          onClick={onDone}
          className="rounded-full bg-page px-4 py-1.5 font-semibold text-ink"
        >
          Join now
        </Link>
        <button
          type="button"
          onClick={onDone}
          aria-label="Dismiss"
          className="cursor-pointer rounded-full px-2 py-1.5 font-semibold"
        >
          ✕
        </button>
      </span>
    </div>
  );
}
