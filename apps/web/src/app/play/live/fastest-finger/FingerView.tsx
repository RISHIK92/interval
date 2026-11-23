"use client";

import { AiDrafted } from "../../../ui/AiDrafted";
import { useEffect, useState } from "react";
import type { FingerState } from "@interval/game-client";
import type { ViewProps } from "../LivePlay";
import { LIVE_QUESTIONS } from "../../../../server/ports";

const LETTERS = ["A", "B", "C", "D"];
// Phones: a row per option. Wide screens: the design's cards side by side, each with
// its letter in a key cap (Fastest finger, web).
const OPTION =
  "flex w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left lg:min-h-24 lg:rounded-[20px] lg:border-[1.5px] lg:px-3.5 lg:text-[17px] lg:font-semibold";
const OPTIONS =
  "flex flex-col lg:grid lg:grid-cols-[repeat(auto-fit,minmax(11.875rem,1fr))] lg:gap-3";
const KEY =
  "font-semibold lg:flex lg:h-7 lg:min-w-7 lg:items-center lg:justify-center lg:rounded-lg lg:border-[1.5px] lg:border-b-[3px] lg:border-track lg:text-[13px] lg:text-ink-muted";
const QUESTION =
  "text-lg font-semibold lg:mx-auto lg:max-w-[52.5rem] lg:text-center lg:text-[32px] lg:leading-[1.2] lg:font-bold lg:tracking-[-0.025em]";
const OUTCOME = { won: "You won", lost: "You lost", draw: "A draw" } as const;

const secondsTo = (endsAt: number) =>
  Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));

function SecondsLeft({ endsAt }: { endsAt: number }) {
  const [seconds, setSeconds] = useState(() => secondsTo(endsAt));
  useEffect(() => {
    const tick = () => {
      setSeconds(secondsTo(endsAt));
    };
    tick();
    const timer = setInterval(tick, 250);
    return () => {
      clearInterval(timer);
    };
  }, [endsAt]);
  return <>{seconds}</>;
}

// The round's time as a bar draining to its end (wide screens). The state carries only
// the round's end, so the bar's full length is the time left when the round arrived.
function TimeBar({ endsAt }: { endsAt: number }) {
  const [total] = useState(() => Math.max(1, endsAt - Date.now()));
  const [left, setLeft] = useState(total);
  useEffect(() => {
    const tick = () => {
      setLeft(Math.max(0, endsAt - Date.now()));
    };
    const timer = setInterval(tick, 250);
    return () => {
      clearInterval(timer);
    };
  }, [endsAt]);
  return (
    <div aria-hidden="true" className="hidden h-2 rounded bg-track lg:block">
      <div
        className="h-2 rounded bg-(--system-design-left) transition-[width] duration-200"
        style={{ width: `${String(Math.min(100, (left / total) * 100))}%` }}
      />
    </div>
  );
}

// Wide screens: the score as the design's tug of war, you in blue and the opponent in
// orange; the words stay for screen readers.
function ScoreBar({ mine, theirs }: { mine: number; theirs: number }) {
  return (
    <div aria-hidden="true" className="hidden items-center gap-3 lg:flex">
      <span className="flex size-9 items-center justify-center rounded-full bg-(--distributed-systems-tint) text-[13px] font-bold text-(--distributed-systems-line)">
        You
      </span>
      <span className="text-[28px] font-bold tabular-nums">{mine}</span>
      <div className="flex h-3 flex-1 gap-1">
        <div
          className="rounded-md bg-(--distributed-systems-left)"
          style={{ flex: mine + theirs === 0 ? 1 : mine }}
        />
        <div
          className="rounded-md bg-(--system-design-left)"
          style={{ flex: mine + theirs === 0 ? 1 : theirs }}
        />
      </div>
      <span className="text-[28px] font-bold text-ink-muted tabular-nums">
        {theirs}
      </span>
      <span className="flex size-9 items-center justify-center rounded-full bg-(--system-design-tint) text-[13px] font-bold text-(--system-design-line)">
        Opp
      </span>
      <span className="ml-3 text-sm text-ink-muted">
        {LIVE_QUESTIONS.fastest_finger} rounds
      </span>
    </div>
  );
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
    <>
      <p className="text-sm font-semibold tabular-nums lg:sr-only">
        Rounds: you {mine} · opponent {theirs}
      </p>
      <ScoreBar mine={mine} theirs={theirs} />
    </>
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
      <div className="flex flex-col gap-4 lg:gap-5">
        {header}
        <p
          role="status"
          className="font-semibold lg:rounded-[14px] lg:bg-well lg:px-4 lg:py-3 lg:text-sm"
        >
          {took}
        </p>
        <p className={QUESTION}>
          {state.stem}
          {state.ai ? <AiDrafted /> : null}
        </p>
        <ul className={`${OPTIONS} gap-1.5`}>
          {state.options.map((option, i) => (
            <li
              key={LETTERS[i]}
              className={`${OPTION} lg:flex-wrap ${i === state.correct ? "border-go bg-go-soft" : "border-hairline lg:border-track"}`}
            >
              <span className={KEY}>{LETTERS[i]}</span>
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
    <div className="flex flex-col gap-4 lg:gap-5">
      <div className="flex items-center justify-between lg:flex-col lg:items-stretch lg:gap-5">
        {header}
        <div className="flex flex-col gap-2">
          <p
            aria-label="Seconds left"
            className="text-sm font-semibold tabular-nums lg:flex lg:items-baseline lg:justify-between lg:font-normal lg:text-ink-muted"
          >
            <span>Round {state.n} · </span>
            <span className="lg:text-lg lg:font-bold lg:text-(--system-design-line)">
              <SecondsLeft endsAt={state.endsAt} />s
            </span>
          </p>
          <TimeBar key={state.n} endsAt={state.endsAt} />
        </div>
      </div>
      <p role="status" aria-live="polite" className="text-sm lg:text-center">
        {lockedIn ? "🔒 You: locked in" : "You: choose an answer"} ·{" "}
        {opponentLocked ? "🔒 Opponent: locked in" : "⏳ Opponent: thinking"}
      </p>
      <fieldset className={`${OPTIONS} gap-2`}>
        <legend className={`mb-3 lg:mb-5 ${QUESTION}`}>
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
            className={`${OPTION} cursor-pointer border-hairline disabled:opacity-60 lg:border-track lg:bg-page lg:hover:border-ink-muted`}
          >
            <span className={KEY}>{LETTERS[i]}</span>
            {option}
          </button>
        ))}
      </fieldset>
    </div>
  );
}
