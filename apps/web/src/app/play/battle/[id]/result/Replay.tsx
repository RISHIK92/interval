"use client";

import { useEffect, useState } from "react";
import { elapsed, Timeline } from "./Timeline";

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
  const start = new Date(frames[0]?.takenAt ?? 0).getTime();
  const labelOf = (i: number) =>
    elapsed(new Date(frames[i]?.takenAt ?? 0).getTime() - start);
  return (
    <section aria-label="Replay" className="flex flex-col gap-2 lg:gap-3">
      <h2 className="text-title lg:text-section lg:tracking-normal">Replay</h2>
      <Timeline
        count={frames.length}
        at={at}
        onAt={onAt}
        labelOf={labelOf}
        name="Moment in the battle"
      />
      {frame !== undefined && (
        <p className="text-sm text-ink-muted">
          <span className="font-semibold text-ink">{frame.name}</span> at{" "}
          {labelOf(at)}
          {shown === null ? "" : ` · ${shown.language}`}
        </p>
      )}
      {missing ? (
        <p className="rounded-2xl bg-well px-4 py-3 text-sm text-ink-muted">
          This moment&apos;s code is gone.
        </p>
      ) : (
        <pre className="max-h-[50vh] overflow-auto rounded-md border border-hairline p-3 font-mono text-xs lg:rounded-2xl lg:bg-well">
          {shown?.code ?? ""}
        </pre>
      )}
    </section>
  );
}
