"use client";

import { AiDrafted } from "../../../ui/AiDrafted";
import { useEffect, useState } from "react";
import type { FingerState } from "@interval/game-client";
import type { ViewProps } from "../LivePlay";

const LETTERS = ["A", "B", "C", "D"];
const OPTION =
  "flex w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left";
const OUTCOME = { won: "You won", lost: "You lost", draw: "A draw" } as const;

function SecondsLeft({ endsAt }: { endsAt: number }) {
  const left = () => Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
  const [seconds, setSeconds] = useState(left);
  useEffect(() => {
    const tick = () => {
      setSeconds(Math.max(0, Math.ceil((endsAt - Date.now()) / 1000)));
    };
    tick();
    const timer = setInterval(tick, 250);
    return () => {
      clearInterval(timer);
    };
  }, [endsAt]);
  return <>{seconds}</>;
}

// Rounds taken: the player's own, and the opponent's.
function score(totals: Record<string, number>, you: string | null) {
  const mine = you === null ? 0 : (totals[you] ?? 0);
  const theirs = Object.entries(totals)
    .filter(([player]) => player !== you)
    .reduce((sum, [, n]) => sum + n, 0);
  return { mine, theirs };
}

// P3-W16-S05 (Q-P3-24): fastest finger on screen. Locked answers and the opponent's
// status carry an icon and a word, not color alone (wireframe 12).
export function FingerView({
  state,
  answered,
  onAnswer,
}: ViewProps<FingerState>) {
  if (state.phase === "cancelled")
    return (
      <p role="status" className="rounded-2xl bg-well px-4 py-3">
        Your opponent didn&apos;t join, so the match was cancelled.
      </p>
    );
  if (state.phase === "final") {
    const { mine, theirs } = score(state.totals, state.you);
    return (
      <div className="flex flex-col gap-2">
        <h2 className="text-display">{OUTCOME[state.outcome]}</h2>
        {state.abandoned.some((p) => p !== state.you) ? (
          <p className="text-ink-muted">Your opponent left the match.</p>
        ) : null}
        <p className="font-semibold tabular-nums">
          Rounds taken: you {mine} · opponent {theirs}
        </p>
        <p className="text-sm text-ink-muted">
          Your rating updates on Play in a moment.
        </p>
      </div>
    );
  }
  if (state.phase === "connecting")
    return (
      <p role="status" className="text-ink-muted">
        Opponent found. Connecting…
      </p>
    );
  const { mine, theirs } = score(state.totals, state.you);
  const header = (
    <p className="text-sm font-semibold tabular-nums">
      Rounds: you {mine} · opponent {theirs}
    </p>
  );
  if (state.phase === "countdown")
    return (
      <div role="status" className="flex flex-col items-center gap-2 py-12">
        <p className="text-ink-muted">Get ready</p>
        <p className="text-display tabular-nums">
          <SecondsLeft endsAt={state.endsAt} />
        </p>
      </div>
    );
  if (state.phase === "waiting")
    return (
      <div className="flex flex-col gap-4">
        {header}
        <p role="status" className="text-ink-muted">
          Back in the match. The next round is coming…
        </p>
      </div>
    );
  if (state.phase === "reveal") {
    const took =
      state.taken === ""
        ? "Nobody took this round"
        : state.taken === state.you
          ? "✓ You took this round"
          : "✗ Your opponent took this round";
    return (
      <div className="flex flex-col gap-4">
        {header}
        <p role="status" className="font-semibold">
          {took}
        </p>
        <p className="text-lg font-semibold">
          {state.stem}
          {state.ai ? <AiDrafted /> : null}
        </p>
        <ul className="flex flex-col gap-1.5">
          {state.options.map((option, i) => (
            <li
              key={LETTERS[i]}
              className={`${OPTION} ${i === state.correct ? "border-go bg-go-soft" : "border-hairline"}`}
            >
              <span className="font-semibold">{LETTERS[i]}</span>
              <span className="flex-1">{option}</span>
              {i === state.correct ? (
                <span className="text-sm font-semibold">✓ Right answer</span>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    );
  }
  const you = state.you;
  const lockedIn =
    answered === state.n ||
    (you !== null && state.locked.players.includes(you));
  const opponentLocked = state.locked.players.some((p) => p !== you);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        {header}
        <p
          aria-label="Seconds left"
          className="text-sm font-semibold tabular-nums"
        >
          Round {state.n} · <SecondsLeft endsAt={state.endsAt} />s
        </p>
      </div>
      <p role="status" aria-live="polite" className="text-sm">
        {lockedIn ? "🔒 You: locked in" : "You: choose an answer"} ·{" "}
        {opponentLocked ? "🔒 Opponent: locked in" : "⏳ Opponent: thinking"}
      </p>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-3 text-lg font-semibold">
          {state.stem}
          {state.ai ? <AiDrafted /> : null}
        </legend>
        {state.options.map((option, i) => (
          <button
            key={LETTERS[i]}
            type="button"
            disabled={lockedIn}
            onClick={() => {
              onAnswer(state.n, i);
            }}
            className={`${OPTION} cursor-pointer border-hairline disabled:opacity-60`}
          >
            <span className="font-semibold">{LETTERS[i]}</span>
            {option}
          </button>
        ))}
      </fieldset>
    </div>
  );
}
