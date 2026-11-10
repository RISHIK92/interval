"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { AiBox } from "../ui/AiBox";
import { type Player, type PlayerState, player, SKIP_SECONDS } from "./player";

// P4-W23-S01 (§4.1, §5G, wireframe 07): the global mini-player, above the tab bar on
// phones and a card in the corner on wide screens, expanding into the full player.
// Signed out, a guest, or nothing queued: nothing shown.

const IDLE: PlayerState = {
  status: "idle",
  queue: [],
  upNext: null,
  current: null,
  playing: false,
  time: 0,
  speed: 1,
  dismissed: false,
  error: null,
};

export function usePlayer(): PlayerState {
  return useSyncExternalStore(
    (listener) => player().subscribe(listener),
    () => player().snapshot(),
    () => IDLE,
  );
}

export const clock = (seconds: number) => {
  const whole = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(whole / 60))}:${String(whole % 60).padStart(2, "0")}`;
};

type Actions = Pick<
  Player,
  | "toggle"
  | "seek"
  | "skip"
  | "next"
  | "play"
  | "remove"
  | "cycleSpeed"
  | "dismiss"
>;

const ROUND =
  "flex size-10 shrink-0 items-center justify-center rounded-full border border-hairline bg-page text-ink";

function Glyph({
  path,
  className = "size-5",
}: {
  path: string;
  className?: string;
}) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={path} />
    </svg>
  );
}

const PLAY = "M8 5v14l11-7z";
const PAUSE = "M8 5v14M16 5v14";

export const visible = (state: PlayerState) =>
  state.status === "ready" &&
  !state.dismissed &&
  (state.current !== null || state.upNext !== null);

export function PlayerBar(props: {
  state: PlayerState;
  actions: Actions;
  onExpand: () => void;
}) {
  const { state, actions } = props;
  const current = state.current;
  return (
    <section
      aria-label="Audio player"
      className="fixed inset-x-2 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-20 flex items-center gap-3 rounded-2xl border border-hairline bg-page px-3 py-2 shadow-lg lg:inset-x-auto lg:right-4 lg:bottom-4 lg:w-96"
    >
      <button
        type="button"
        onClick={props.onExpand}
        className="min-w-0 flex-1 text-left"
        aria-label="Open the player"
      >
        <span className="block truncate font-semibold">
          {current?.concept ?? `Up next: ${state.upNext?.concept ?? ""}`}
        </span>
        {state.error !== null && (
          <span role="alert" className="block text-sm">
            {state.error}
          </span>
        )}
        <span className="block text-sm text-ink-muted">
          {current === null
            ? "AI explainer · tap to play"
            : `AI explainer · ${clock(state.time)} / ${clock(current.durationSeconds)}`}
        </span>
      </button>
      {current === null ? (
        state.upNext !== null && (
          <button
            type="button"
            className={ROUND}
            aria-label={`Play ${state.upNext.concept}`}
            onClick={() => void actions.play(state.upNext?.explainerId ?? "")}
          >
            <Glyph path={PLAY} />
          </button>
        )
      ) : (
        <button
          type="button"
          className={ROUND}
          aria-label={state.playing ? "Pause" : "Play"}
          onClick={() => void actions.toggle()}
        >
          <Glyph path={state.playing ? PAUSE : PLAY} />
        </button>
      )}
      <button
        type="button"
        className={ROUND}
        aria-label="Close the player"
        onClick={actions.dismiss}
      >
        <Glyph path="M6 6l12 12M18 6L6 18" />
      </button>
    </section>
  );
}

export function FullPlayer(props: {
  state: PlayerState;
  actions: Actions;
  onClose: () => void;
}) {
  const { state, actions } = props;
  const current = state.current;
  const shown = current ?? state.upNext;
  const later = state.queue.filter(
    (q) => q.explainerId !== current?.explainerId,
  );
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Player"
      className="fixed inset-0 z-30 overflow-y-auto bg-page px-4 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))] lg:inset-x-auto lg:right-0 lg:w-[28rem] lg:border-l lg:border-hairline"
    >
      <div className="mx-auto flex max-w-md flex-col gap-5">
        <div className="flex items-center justify-between">
          <button
            type="button"
            className={ROUND}
            aria-label="Close"
            onClick={props.onClose}
          >
            <Glyph path="M6 9l6 6 6-6" />
          </button>
          {/* §5G's two modes: only Smart explain is voiced so far (owner, 2026-11-10). */}
          <div
            role="group"
            aria-label="Mode"
            className="flex rounded-full bg-well p-1 text-sm"
          >
            <button
              type="button"
              aria-disabled="true"
              title="Coming later"
              className="cursor-not-allowed rounded-full px-3 py-1 text-ink-muted opacity-50"
            >
              Original<span className="sr-only">. Coming later</span>
            </button>
            <button
              type="button"
              aria-pressed="true"
              className="rounded-full bg-page px-3 py-1 font-semibold"
            >
              Smart explain
            </button>
          </div>
          <span className="size-10" />
        </div>
        {/* AI-1: said under the switch, every time. */}
        <p className="text-center text-sm text-ink-muted">
          You’re hearing AI, not the author.
        </p>
        {shown !== null && (
          <h2 className="text-center text-2xl font-semibold">
            {shown.concept}
          </h2>
        )}
        {current !== null && (
          <>
            <label className="flex flex-col gap-1">
              <span className="sr-only">Position</span>
              <input
                type="range"
                min={0}
                max={current.durationSeconds}
                step={1}
                value={Math.min(state.time, current.durationSeconds)}
                onChange={(e) => {
                  actions.seek(Number(e.target.value));
                }}
              />
              <span className="flex justify-between text-sm text-ink-muted">
                <span>{clock(state.time)}</span>
                <span>{clock(current.durationSeconds)}</span>
              </span>
            </label>
            <div className="flex items-center justify-center gap-4">
              <button
                type="button"
                className={ROUND}
                aria-label={`Back ${String(SKIP_SECONDS)} seconds`}
                onClick={() => {
                  actions.skip(-SKIP_SECONDS);
                }}
              >
                <span className="text-xs font-semibold">−{SKIP_SECONDS}</span>
              </button>
              <button
                type="button"
                className="flex size-14 items-center justify-center rounded-full bg-ink text-page"
                aria-label={state.playing ? "Pause" : "Play"}
                onClick={() => void actions.toggle()}
              >
                <Glyph path={state.playing ? PAUSE : PLAY} className="size-6" />
              </button>
              <button
                type="button"
                className={ROUND}
                aria-label={`Forward ${String(SKIP_SECONDS)} seconds`}
                onClick={() => {
                  actions.skip(SKIP_SECONDS);
                }}
              >
                <span className="text-xs font-semibold">+{SKIP_SECONDS}</span>
              </button>
              <button
                type="button"
                className="rounded-full border border-hairline px-3 py-2 text-sm font-semibold"
                aria-label={`Speed ${String(state.speed)}×. Change speed`}
                onClick={actions.cycleSpeed}
              >
                {state.speed}×
              </button>
            </div>
          </>
        )}
        {state.error !== null && (
          <p role="alert" className="text-center text-sm">
            {state.error}
          </p>
        )}
        {later.length > 0 && (
          <section aria-label="Queue" className="flex flex-col gap-2">
            <h3 className="font-semibold">In your queue</h3>
            <ul className="flex flex-col gap-2">
              {later.map((q) => (
                <li key={q.explainerId} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate">{q.concept}</span>
                  <button
                    type="button"
                    className="text-sm underline"
                    onClick={() => void actions.play(q.explainerId)}
                  >
                    Play
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
        {/* Wireframe 07: Up next follows the concept graph; played only on a tap. */}
        {later.length === 0 && state.upNext !== null && (
          <section aria-label="Up next" className="flex items-center gap-2">
            <span className="min-w-0 flex-1">
              <span className="block text-sm text-ink-muted">Up next</span>
              <span className="block truncate font-semibold">
                {state.upNext.concept}
              </span>
            </span>
            <button
              type="button"
              className="rounded-full bg-ink px-4 py-2 text-sm font-semibold text-page"
              onClick={() => void actions.play(state.upNext?.explainerId ?? "")}
            >
              Play
            </button>
          </section>
        )}
        {/* AI-3: the sections this explainer was written from, as deep links. */}
        {shown !== null && shown.sources.length > 0 && (
          <AiBox>
            <span className="block text-sm font-semibold">Written from</span>
            <ul className="mt-1 flex flex-col gap-1 text-sm">
              {shown.sources.map((s) => (
                <li key={s.href}>
                  <a
                    href={s.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline"
                  >
                    {s.title}
                  </a>
                </li>
              ))}
            </ul>
          </AiBox>
        )}
      </div>
    </div>
  );
}

export function MiniPlayer() {
  const state = usePlayer();
  const [open, setOpen] = useState(false);
  const shown = visible(state);
  useEffect(() => {
    player()
      .load()
      .catch((error: unknown) => {
        console.error(error);
      });
  }, []);
  // Room at the bottom of every page while the bar is up (globals.css).
  useEffect(() => {
    if (shown) document.documentElement.dataset["player"] = "";
    else delete document.documentElement.dataset["player"];
  }, [shown]);
  if (!shown) return null;
  const actions = player();
  return open ? (
    <FullPlayer
      state={state}
      actions={actions}
      onClose={() => {
        setOpen(false);
      }}
    />
  ) : (
    <PlayerBar
      state={state}
      actions={actions}
      onExpand={() => {
        setOpen(true);
      }}
    />
  );
}
