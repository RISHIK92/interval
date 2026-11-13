"use client";

import { useEffect, useState } from "react";

// P5-W35 (DB-6; Q-P5-22): every player's code over time, from the 30-second snapshots,
// once the battle is over: a scrubber over the frames, oldest first.
type Frame = { name: string; takenAt: string };
type Shown = { language: string; code: string };

export function Replay({
  matchId,
  frames,
}: {
  matchId: string;
  frames: Frame[];
}) {
  const [at, setAt] = useState(frames.length - 1);
  const [shown, setShown] = useState<Shown | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let stale = false;
    fetch(`/api/battle/${matchId}/replay?n=${String(at)}`)
      .then(async (res) => {
        if (stale) return;
        if (!res.ok) {
          setMissing(true);
          return;
        }
        setMissing(false);
        setShown((await res.json()) as Shown);
      })
      .catch((error: unknown) => {
        console.error("battle: replay frame not read", error);
      });
    return () => {
      stale = true;
    };
  }, [matchId, at]);

  return (
    <ReplayView
      frames={frames}
      at={at}
      shown={shown}
      missing={missing}
      onAt={setAt}
    />
  );
}

export function ReplayView({
  frames,
  at,
  shown,
  missing,
  onAt,
}: {
  frames: Frame[];
  at: number;
  shown: Shown | null;
  missing: boolean;
  onAt: (at: number) => void;
}) {
  const frame = frames[at];
  return (
    <section aria-label="Replay" className="flex flex-col gap-2">
      <h2 className="text-title">Replay</h2>
      <input
        type="range"
        min={0}
        max={frames.length - 1}
        value={at}
        aria-label="Moment in the battle"
        onChange={(e) => {
          onAt(Number(e.target.value));
        }}
      />
      {frame !== undefined && (
        <p className="text-sm text-ink-muted">
          {frame.name} · {new Date(frame.takenAt).toLocaleTimeString()}
          {shown === null ? "" : ` · ${shown.language}`}
        </p>
      )}
      {missing ? (
        <p className="text-sm text-ink-muted">
          This moment&apos;s code is gone.
        </p>
      ) : (
        <pre className="max-h-[50vh] overflow-auto rounded-md border border-line p-3 font-mono text-xs">
          {shown?.code ?? ""}
        </pre>
      )}
    </section>
  );
}
