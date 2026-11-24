"use client";

import type { BattleState } from "@interval/game-client";
// The hints module alone: the package's entry also exports the verifier (node APIs).
import { HINT_LEVELS } from "@interval/lld/hints";
import { useState } from "react";
import { Statement } from "./Statement";

// Q-WD-17 (owner, 2026-11-23): "Stuck? Hints cost points". Three outlined rows, each
// with what the game server says it costs (nothing in practice). In a battle a level is
// confirmed before it opens: its cost comes off the player's best for good. Opened
// hints are shown under the rows, the code sketch as written.
type Hints = NonNullable<Extract<BattleState, { phase: "playing" }>["hints"]>;

const LOWER: Record<string, string> = {
  Nudge: "the nudge",
  Approach: "the approach",
  "Code sketch": "the code sketch",
};

export function HintPanel({
  hints,
  onOpen,
  notice = null,
}: {
  hints: Hints;
  onOpen: (level: number) => void;
  // Why the last one asked for didn't go (no connection).
  notice?: string | null;
}) {
  const [asking, setAsking] = useState<number | null>(null);
  const free = hints.costs.every((c) => c === 0);
  const opened = [...hints.opened].sort((a, b) => a.level - b.level);
  return (
    <section
      aria-label="Hints"
      className="flex flex-col gap-2 lg:mt-3.5 lg:gap-1.5"
    >
      <h2 className="text-title lg:text-[15px] lg:font-semibold lg:tracking-normal">
        {free
          ? "Stuck? Hints are free in practice"
          : "Stuck? Hints cost points"}
      </h2>
      <ul className="flex flex-col gap-1.5">
        {HINT_LEVELS.map((name, i) => {
          const level = i + 1;
          const cost = hints.costs[i] ?? 0;
          const done = hints.opened.some((h) => h.level === level);
          return (
            <li key={name}>
              <button
                type="button"
                disabled={done}
                aria-label={
                  done
                    ? `${name}, opened`
                    : cost === 0
                      ? name
                      : `${name}, −${String(cost)} ${cost === 1 ? "point" : "points"}`
                }
                onClick={() => {
                  if (cost === 0) onOpen(level);
                  else setAsking(level);
                }}
                className="flex w-full items-center justify-between rounded-xl border-[1.5px] border-hairline-strong px-3 py-2 text-sm font-semibold disabled:opacity-50 lg:text-[13px]"
              >
                <span>{name}</span>
                {done ? (
                  <span className="font-normal text-ink-muted">Opened</span>
                ) : cost === 0 ? null : (
                  <span className="tabular-nums text-ink-muted">−{cost}</span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      {notice !== null && (
        <p role="status" className="text-[13px] text-ink-muted">
          {notice}
        </p>
      )}
      {asking !== null && (
        <div
          role="alertdialog"
          aria-label="Open a hint"
          className="flex flex-col gap-2 rounded-xl bg-well px-3 py-2.5 text-sm lg:text-[13px]"
        >
          <p>
            Open {LOWER[HINT_LEVELS[asking - 1] ?? ""] ?? "this hint"}? It takes{" "}
            {hints.costs[asking - 1] ?? 0}{" "}
            {hints.costs[asking - 1] === 1 ? "point" : "points"} off your best.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                onOpen(asking);
                setAsking(null);
              }}
              className="rounded-full bg-ink px-4 py-1.5 font-semibold text-page"
            >
              Open it
            </button>
            <button
              type="button"
              onClick={() => {
                setAsking(null);
              }}
              className="rounded-full px-3 py-1.5 font-semibold text-ink-muted"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {opened.length > 0 && (
        <div aria-live="polite" className="flex flex-col gap-2.5">
          {opened.map((h) => (
            <div key={h.level} className="rounded-xl bg-well px-3 py-2.5">
              <h3 className="text-sm font-semibold lg:text-[13px]">
                {HINT_LEVELS[h.level - 1]}
              </h3>
              {h.level === HINT_LEVELS.length ? (
                <pre className="mt-1 overflow-x-auto font-mono text-xs leading-[1.7]">
                  {h.text}
                </pre>
              ) : (
                <div className="mt-1">
                  <Statement markdown={h.text} dropTitle={false} />
                </div>
              )}
            </div>
          ))}
          {hints.spent > 0 && (
            <p className="text-[13px] text-ink-muted tabular-nums">
              Hints: −{hints.spent}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
