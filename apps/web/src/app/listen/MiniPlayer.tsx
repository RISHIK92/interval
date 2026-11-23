"use client";

import { type Caption, sentenceAt } from "@interval/api-client";
import { Fragment, useEffect, useState, useSyncExternalStore } from "react";
import { AiBox } from "../ui/AiBox";
import { type Player, type PlayerState, player, SKIP_SECONDS } from "./player";
import { Scene } from "./Scene";

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

// P4-W23-S03 (TTS-3; owner, 2026-11-11): the sentence being said, its word marked by
// weight and underline (not colour alone). A visual aid to the audio, so screen readers
// skip it. `wide`: the copy in the wide screen's transcript card (design "Audio player,
// web"), larger, beside the phone's.
export function Captions(props: {
  captions: Caption[];
  time: number;
  wide?: boolean;
}) {
  const { words, current } = sentenceAt(props.captions, props.time);
  if (words.length === 0) return null;
  return (
    <p
      aria-hidden="true"
      data-testid={props.wide === true ? undefined : "captions"}
      className={
        props.wide === true
          ? "min-h-[3.5rem] text-xl leading-snug font-medium tracking-tight"
          : "min-h-[3.5rem] text-center text-lg leading-relaxed lg:hidden"
      }
    >
      {words.map((w, i) => (
        <Fragment key={`${String(w.start)}:${String(i)}`}>
          {i > 0 && " "}
          {i === current ? (
            <span className="font-semibold text-ink underline">{w.text}</span>
          ) : (
            <span className="text-ink-muted">{w.text}</span>
          )}
        </Fragment>
      ))}
    </p>
  );
}

const BACK = "M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5";
const FORWARD = "M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5";

// Phones: one column, the player over everything (wireframe 07). Wide screens (design
// "Audio player, web"): the page area beside the sidebar, the player on the left and
// what it says, the queue and its sources on the right.
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
      className="fixed inset-0 z-30 overflow-y-auto bg-page px-4 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))] lg:left-50 lg:px-8 lg:pt-7 lg:pb-9"
    >
      <div className="mx-auto flex max-w-md flex-col gap-5 lg:grid lg:max-w-[60rem] lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:items-start lg:gap-x-6 lg:gap-y-5">
        <div className="flex items-center justify-between lg:col-span-2">
          <button
            type="button"
            className={`${ROUND} lg:hidden`}
            aria-label="Close"
            onClick={props.onClose}
          >
            <Glyph path="M6 9l6 6 6-6" />
          </button>
          {/* The web design's word for the same control; phones keep Close. */}
          <button
            type="button"
            className="hidden h-10 items-center gap-1.5 rounded-full bg-well pr-4 pl-3 text-sm font-semibold lg:flex"
            onClick={props.onClose}
          >
            <Glyph path="M6 9l6 6 6-6" className="size-4" />
            Minimize
          </button>
          {/* §5G's two modes: only Smart explain is voiced so far (owner, 2026-11-10). */}
          <div
            role="group"
            aria-label="Mode"
            className="flex rounded-full bg-well p-1 text-sm lg:h-10 lg:rounded-xl"
          >
            <button
              type="button"
              aria-disabled="true"
              title="Coming later"
              className="cursor-not-allowed rounded-full px-3 py-1 text-ink-muted opacity-50 lg:rounded-[0.5625rem] lg:px-4"
            >
              Original<span className="sr-only">. Coming later</span>
            </button>
            <button
              type="button"
              aria-pressed="true"
              className="rounded-full bg-page px-3 py-1 font-semibold lg:flex lg:items-center lg:gap-1.5 lg:rounded-[0.5625rem] lg:bg-lift lg:px-4 lg:shadow-card"
            >
              <Glyph
                path="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"
                className="hidden size-3.5 lg:block"
              />
              Smart explain
            </button>
          </div>
          <span className="size-10 lg:hidden" />
        </div>
        <div className="flex flex-col gap-5 lg:col-start-1">
          {/* AI-1: said under the switch, every time. */}
          <p className="text-center text-sm text-ink-muted lg:order-3 lg:-mt-4 lg:text-left">
            You’re hearing AI, not the author.
          </p>
          {shown !== null && (
            <h2 className="text-center text-2xl font-semibold lg:order-2 lg:text-left lg:text-[1.875rem] lg:leading-tight lg:font-bold lg:tracking-tight">
              {shown.concept}
            </h2>
          )}
          {current !== null && (
            <>
              {current.scene !== null && (
                <div className="lg:order-1">
                  <Scene
                    url={current.scene}
                    captions={current.captions}
                    time={state.time}
                  />
                </div>
              )}
              <Captions captions={current.captions} time={state.time} />
              <label className="flex flex-col gap-1 lg:order-4 lg:gap-2">
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
                  className="lg:accent-ink"
                />
                <span className="flex justify-between text-sm text-ink-muted tabular-nums">
                  <span>{clock(state.time)}</span>
                  <span>{clock(current.durationSeconds)}</span>
                </span>
              </label>
              <div className="flex items-center justify-center gap-4 lg:order-5 lg:gap-5">
                <button
                  type="button"
                  className={`${ROUND} lg:size-11 lg:border-0 lg:bg-transparent`}
                  aria-label={`Back ${String(SKIP_SECONDS)} seconds`}
                  onClick={() => {
                    actions.skip(-SKIP_SECONDS);
                  }}
                >
                  <span className="text-xs font-semibold lg:hidden">
                    −{SKIP_SECONDS}
                  </span>
                  <Glyph path={BACK} className="hidden size-6 lg:block" />
                </button>
                <button
                  type="button"
                  className="flex size-14 items-center justify-center rounded-full bg-ink text-page lg:size-[4.75rem]"
                  aria-label={state.playing ? "Pause" : "Play"}
                  onClick={() => void actions.toggle()}
                >
                  <Glyph
                    path={state.playing ? PAUSE : PLAY}
                    className="size-6 lg:size-7"
                  />
                </button>
                <button
                  type="button"
                  className={`${ROUND} lg:size-11 lg:border-0 lg:bg-transparent`}
                  aria-label={`Forward ${String(SKIP_SECONDS)} seconds`}
                  onClick={() => {
                    actions.skip(SKIP_SECONDS);
                  }}
                >
                  <span className="text-xs font-semibold lg:hidden">
                    +{SKIP_SECONDS}
                  </span>
                  <Glyph path={FORWARD} className="hidden size-6 lg:block" />
                </button>
                <button
                  type="button"
                  className="rounded-full border border-hairline px-3 py-2 text-sm font-semibold lg:order-first lg:flex lg:h-11 lg:items-center lg:rounded-xl lg:border-0 lg:bg-well lg:px-3 lg:text-[0.9375rem] lg:tabular-nums"
                  aria-label={`Speed ${String(state.speed)}×. Change speed`}
                  onClick={actions.cycleSpeed}
                >
                  {state.speed}×
                </button>
              </div>
            </>
          )}
          {state.error !== null && (
            <p role="alert" className="text-center text-sm lg:order-6">
              {state.error}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-5 lg:col-start-2">
          {current !== null && current.captions.length > 0 && (
            <section
              aria-hidden="true"
              className="hidden flex-col gap-3 rounded-3xl bg-well p-5 lg:flex"
            >
              <span className="flex items-baseline justify-between gap-3">
                <span className="font-semibold">Transcript</span>
                <span className="text-xs font-semibold text-ink-muted">
                  AI explainer
                </span>
              </span>
              <Captions captions={current.captions} time={state.time} wide />
            </section>
          )}
          {later.length > 0 && (
            <section aria-label="Queue" className="flex flex-col gap-2">
              <h3 className="font-semibold lg:text-[1.0625rem]">
                In your queue
              </h3>
              <ul className="flex flex-col gap-2">
                {later.map((q) => (
                  <li
                    key={q.explainerId}
                    className="flex items-center gap-2 lg:gap-3 lg:rounded-2xl lg:border-[1.5px] lg:border-hairline lg:p-2.5 lg:pl-3"
                  >
                    <QueueIcon />
                    <span className="min-w-0 flex-1 truncate lg:font-semibold">
                      {q.concept}
                      <span className="hidden text-[0.8125rem] font-normal text-ink-muted lg:block">
                        AI explainer · {clock(q.durationSeconds)}
                      </span>
                    </span>
                    <button
                      type="button"
                      className="text-sm underline lg:rounded-full lg:border-[1.5px] lg:border-hairline lg:px-3 lg:py-1.5 lg:font-semibold lg:no-underline"
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
            <section
              aria-label="Up next"
              className="flex items-center gap-2 lg:gap-3 lg:rounded-2xl lg:border-[1.5px] lg:border-hairline lg:p-2.5 lg:pl-3"
            >
              <QueueIcon />
              <span className="min-w-0 flex-1">
                <span className="block text-sm text-ink-muted">Up next</span>
                <span className="block truncate font-semibold">
                  {state.upNext.concept}
                </span>
              </span>
              <button
                type="button"
                className="rounded-full bg-ink px-4 py-2 text-sm font-semibold text-page"
                onClick={() =>
                  void actions.play(state.upNext?.explainerId ?? "")
                }
              >
                Play
              </button>
            </section>
          )}
          {/* The words as text, for screen readers and braille (the captions above
            move, so they're hidden from them), and anyone who'd rather read. */}
          {shown !== null && shown.captions.length > 0 && (
            <details className="text-sm">
              <summary className="cursor-pointer font-semibold">
                Transcript
              </summary>
              <p className="mt-2 leading-relaxed">
                {shown.captions.map((c) => c.text).join(" ")}
              </p>
            </details>
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
    </div>
  );
}

// The design's tile before each queued item, on wide screens.
function QueueIcon() {
  return (
    <span
      aria-hidden="true"
      className="hidden size-10 shrink-0 items-center justify-center rounded-xl bg-(--review-tint) text-(--review-right) lg:flex"
    >
      <Glyph path="M3 18v-6a9 9 0 0 1 18 0v6M3 14h3v6H3zM18 14h3v6h-3z" />
    </span>
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
