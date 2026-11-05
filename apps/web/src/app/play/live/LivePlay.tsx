"use client";

import Link from "next/link";
import {
  type ComponentType,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import type { GameMode } from "../../../server/ports";
import { openMatch } from "./join";
import { liveHref } from "./href";
import { FALLBACK_MS, type LiveGame, runLive } from "./live-client";

type Screen<S> =
  | { kind: "queue"; since: number }
  | { kind: "match"; state: S }
  | { kind: "error" };

export type ViewProps<S> = {
  state: S;
  answered: number | null; // the question just answered, until the next arrives
  onAnswer: (n: number, choice: number) => void;
};

// C-01 (screen 11): the seconds until a ghost or bot takes over, as a bar and a number.
export function FallbackCountdown({
  since,
  at = since,
}: {
  since: number;
  at?: number; // the first paint's now (tests); the clock ticks on from it
}) {
  const [now, setNow] = useState(at);
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 250);
    return () => {
      clearInterval(timer);
    };
  }, []);
  const total = FALLBACK_MS / 1000;
  const left = Math.max(0, Math.ceil((since + FALLBACK_MS - now) / 1000));
  return (
    <div className="mt-2 flex flex-col gap-1">
      <div
        role="progressbar"
        aria-label="Seconds until a ghost or bot"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={left}
        className="h-1.5 overflow-hidden rounded-full bg-track"
      >
        <div
          className="h-full rounded-full bg-ink"
          style={{ width: `${String((left / total) * 100)}%` }}
        />
      </div>
      <p className="text-sm text-ink-muted tabular-nums">
        {left > 0
          ? `A ghost or bot in ${String(left)}s if nobody's found`
          : "Setting up a ghost or bot…"}
      </p>
    </div>
  );
}

function Waited({ since }: { since: number }) {
  const [now, setNow] = useState(since);
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1_000);
    return () => {
      clearInterval(timer);
    };
  }, []);
  return <>{Math.floor((now - since) / 1000)}</>;
}

// P3-W17-S01, S02 (BOT-3, BOT-4): a match against a ghost or bot says so on screen for
// its whole length, and at its end that the rating moves half as much. A person:
// nothing added.
export function ReplayFrame({
  label,
  finished,
  children,
}: {
  label: string | null;
  finished: boolean;
  children: ReactNode;
}) {
  if (label === null) return <>{children}</>;
  return (
    <div className="flex flex-col gap-4">
      <p className="self-start rounded-full bg-well px-4 py-1.5 text-sm font-semibold">
        vs {label}: not a live player
      </p>
      {children}
      {finished ? (
        <p className="text-sm text-ink-muted">
          Against a ghost or bot, your rating moves half as much.
        </p>
      ) : null}
    </div>
  );
}

// P3-W16-S04, S05 (Q-P3-23, Q-P3-24): a live 1v1 game. Queue (join, poll about once a
// second, leave when the screen goes), then the match over the game server's socket,
// then the result. Play again queues afresh.
export function LivePlay<S>({
  mode,
  game: rules,
  current,
  View,
  matchId,
}: {
  mode: GameMode;
  // P3-W17-S03: a friend challenge's match, joined without the queue.
  matchId?: string | undefined;
  game: LiveGame<S>;
  // The question in play, if any: a new one takes answers again. A module constant,
  // so it never restarts the match.
  current: (state: S) => number | null;
  View: ComponentType<ViewProps<S>>;
}) {
  // A friend challenge starts in its match; Play again then queues as usual.
  const [challenge, setChallenge] = useState(matchId);
  const [screen, setScreen] = useState<Screen<S>>(() =>
    matchId === undefined
      ? { kind: "queue", since: Date.now() }
      : { kind: "match", state: rules.start },
  );
  const [answered, setAnswered] = useState<number | null>(null);
  const [game, setGame] = useState(0);
  // P3-W17-S01, S02 (BOT-3): a ghost's or bot's label, on screen for the whole match.
  const [opponent, setOpponent] = useState<string | null>(null);
  const [noFallback, setNoFallback] = useState(false);
  const live = useRef<ReturnType<typeof runLive> | null>(null);

  useEffect(() => {
    const run = runLive({
      game: rules,
      ...(challenge === undefined ? {} : { matchId: challenge }),
      queue: (method) =>
        fetch(`/api/game/queue?mode=${mode}`, {
          method,
          keepalive: method === "DELETE",
        }),
      open: async (matchId, on) => {
        // Handlers go on while the socket is still connecting: no frame is missed.
        const ws = await openMatch(matchId);
        ws.onmessage = (event) => {
          on.message(event.data);
        };
        ws.onclose = (event) => {
          on.close(event.reason);
        };
        return ws;
      },
      wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      now: Date.now,
      onState: (state) => {
        setAnswered((n) => (n === current(state) ? n : null));
        setScreen({ kind: "match", state });
      },
      onError: () => {
        setScreen({ kind: "error" });
      },
      fallback: async () => {
        const response = await fetch(`/api/game/bot?mode=${mode}`, {
          method: "POST",
        });
        if (response.status === 404) return null;
        if (!response.ok) throw new Error(`bot: ${String(response.status)}`);
        const body: unknown = await response.json();
        if (
          typeof body !== "object" ||
          body === null ||
          !("matchId" in body) ||
          typeof body.matchId !== "string"
        )
          throw new Error("bot: no match id");
        return body.matchId;
      },
      onNoFallback: () => {
        setNoFallback(true);
      },
      onOpponent: setOpponent,
    });
    live.current = run;
    // P3-W18-S02 (§6.9): another tab or window, as blur or a hidden page; the server
    // counts one switch once.
    const lost = () => {
      run.focusLost();
    };
    const hidden = () => {
      if (document.visibilityState === "hidden") run.focusLost();
    };
    window.addEventListener("blur", lost);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.removeEventListener("blur", lost);
      document.removeEventListener("visibilitychange", hidden);
      run.stop();
      live.current = null;
    };
  }, [game, mode, rules, current, challenge]);

  const again = () => {
    // A challenge's ?match= goes, so a reload doesn't rejoin the finished match.
    if (challenge !== undefined)
      window.history.replaceState(null, "", liveHref(mode));
    setChallenge(undefined);
    setAnswered(null);
    setOpponent(null);
    setNoFallback(false);
    setScreen({ kind: "queue", since: Date.now() });
    setGame((n) => n + 1);
  };
  const finished = screen.kind === "match" && rules.over(screen.state);

  return (
    <div className="flex flex-col gap-6">
      {screen.kind === "queue" ? (
        <div role="status" className="flex flex-col gap-1">
          <p className="text-lg font-semibold">Finding an opponent…</p>
          <p className="text-sm text-ink-muted tabular-nums">
            Waiting <Waited since={screen.since} />
            s, matched by rating.
          </p>
          {noFallback ? (
            <p className="text-sm text-ink-muted">
              No ghost or bot could be set up. Still looking for an opponent.
            </p>
          ) : (
            <FallbackCountdown since={screen.since} />
          )}
          <button
            type="button"
            onClick={() => {
              setNoFallback(false);
              live.current?.fallback();
            }}
            className="mt-3 cursor-pointer self-start rounded-full border border-hairline px-5 py-2.5 font-semibold"
          >
            Play bot now
          </button>
        </div>
      ) : screen.kind === "error" ? (
        <p role="alert" className="rounded-2xl bg-well px-4 py-3">
          The live match couldn&apos;t go on. Try again in a moment.
        </p>
      ) : (
        <ReplayFrame label={opponent} finished={finished}>
          <View
            state={screen.state}
            answered={answered}
            onAnswer={(n, choice) => {
              if (live.current?.answer(n, choice) === true) setAnswered(n);
            }}
          />
          {/* P3-W18-S02 (owner, 2026-11-05): players are told. */}
          {finished ? null : (
            <p className="text-sm text-ink-muted">
              Leaving this tab during a round is noted for fair play.
            </p>
          )}
        </ReplayFrame>
      )}
      <div className="flex flex-wrap gap-3">
        {finished || screen.kind === "error" ? (
          <button
            type="button"
            onClick={again}
            className="cursor-pointer rounded-full bg-ink px-5 py-2.5 font-semibold text-page"
          >
            Play again
          </button>
        ) : null}
        {screen.kind === "match" && !finished ? null : (
          <Link
            href="/play"
            className="rounded-full border border-hairline px-5 py-2.5 font-semibold"
          >
            {screen.kind === "queue" ? "Cancel" : "Back to Play"}
          </Link>
        )}
      </div>
    </div>
  );
}
