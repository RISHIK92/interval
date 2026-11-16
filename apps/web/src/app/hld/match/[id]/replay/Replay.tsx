"use client";

import type { HldProblem } from "@interval/hld";
import { useEffect, useState } from "react";
import { DesignView } from "../../../DesignView";

// P6-W44 (Q-P6-03, Q-P6-08): a finished match's designs as they were drawn: one slider
// moves through time, and each player's design is the last autosave at that moment.
type Frames = {
  seats: {
    player: string;
    total: number | null;
    frames: { at: string; design: unknown }[];
  }[];
};

export function Replay({
  matchId,
  problem,
}: {
  matchId: string;
  problem: HldProblem;
}) {
  const [data, setData] = useState<Frames | null>(null);
  const [failed, setFailed] = useState(false);
  const [step, setStep] = useState(0);
  useEffect(() => {
    fetch(`/api/hld/match/${matchId}/replay`)
      .then(async (r) => {
        if (!r.ok) throw new Error(String(r.status));
        const frames = (await r.json()) as Frames;
        setData(frames);
        setStep(times(frames).length - 1);
      })
      .catch((e: unknown) => {
        console.error("HLD replay not read", e);
        setFailed(true);
      });
  }, [matchId]);
  if (failed) return <p>The replay couldn&apos;t be loaded.</p>;
  if (data === null)
    return <p className="text-ink-muted">Loading the replay…</p>;
  const all = times(data);
  const now = all[step] ?? all.at(-1) ?? "";
  return (
    <div className="flex flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm">
        {all.length === 0
          ? "Nothing was drawn."
          : `${new Date(now).toLocaleTimeString()} (${String(step + 1)} of ${String(all.length)})`}
        <input
          type="range"
          min={0}
          max={Math.max(0, all.length - 1)}
          value={step}
          onChange={(e) => {
            setStep(Number(e.target.value));
          }}
        />
      </label>
      <div className="grid gap-4 lg:grid-cols-2">
        {data.seats.map((s) => {
          const shown = [...s.frames].reverse().find((f) => f.at <= now);
          return (
            <DesignView
              key={s.player}
              problem={problem}
              design={shown?.design ?? null}
              title={`${s.player}${s.total === null ? "" : ` · ${String(s.total)}`}`}
            />
          );
        })}
      </div>
    </div>
  );
}

// Every moment any player saved, in order: the slider's stops.
function times(data: Frames): string[] {
  return [
    ...new Set(data.seats.flatMap((s) => s.frames.map((f) => f.at))),
  ].sort();
}
