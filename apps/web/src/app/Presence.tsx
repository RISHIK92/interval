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
});

// P3-W17-S03 (Q-P3-16; owner, 2026-11-03): while a tab is open and in view it tells the
// server every 10 s that its player is around (a challenge link needs its sender
// online), and shows "Join now" when a friend accepts the player's challenge. Signed
// out (401), it stops.
export function Presence() {
  const [accepted, setAccepted] =
    useState<z.infer<typeof Reply>["challenge"]>(null);
  useEffect(() => {
    let stopped = false;
    const beat = async () => {
      if (stopped || document.visibilityState !== "visible") return;
      const response = await fetch("/api/presence", { method: "POST" });
      if (response.status === 401) {
        stopped = true;
        return;
      }
      if (!response.ok) throw new Error(`presence: ${String(response.status)}`);
      const reply = Reply.parse(await response.json());
      // Lapsed (the match waited its minute): the banner goes with it.
      setAccepted(reply.challenge);
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
    <AcceptedBanner
      accepted={accepted}
      onDone={() => {
        setAccepted(null);
      }}
    />
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
