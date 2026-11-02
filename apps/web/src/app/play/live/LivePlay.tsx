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
import { type LiveGame, runLive } from "./live-client";

type Screen<S> =
  | { kind: "queue"; since: number }
  | { kind: "match"; state: S }
  | { kind: "error" };

export type ViewProps<S> = {
  state: S;
  answered: number | null; // the question just answered, until the next arrives
  onAnswer: (n: number, choice: number) => void;
};

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

// P3-W17-S01 (BOT-3, BOT-4): a match against a ghost says so on screen for its whole
// length, and at its end that the rating moves half as much. A person: nothing added.
export function GhostFrame({
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
        👻 vs {label}: a replay of a real run
      </p>
      {children}
      {finished ? (
        <p className="text-sm text-ink-muted">
          Ghost match: your rating moves half as much.
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
}: {
  mode: GameMode;
  game: LiveGame<S>;
  // The question in play, if any: a new one takes answers again. A module constant,
  // so it never restarts the match.
  current: (state: S) => number | null;
  View: ComponentType<ViewProps<S>>;
}) {
  const [screen, setScreen] = useState<Screen<S>>(() => ({
    kind: "queue",
    since: Date.now(),
  }));
  const [answered, setAnswered] = useState<number | null>(null);
  const [game, setGame] = useState(0);
  // P3-W17-S01 (BOT-3): the ghost's label, on screen for the whole match.
  const [opponent, setOpponent] = useState<string | null>(null);
  const [noGhost, setNoGhost] = useState(false);
  const live = useRef<ReturnType<typeof runLive> | null>(null);

  useEffect(() => {
    const run = runLive({
      game: rules,
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
      ghost: async () => {
        const response = await fetch(`/api/game/ghost?mode=${mode}`, {
          method: "POST",
        });
        if (response.status === 404) return null;
        if (!response.ok) throw new Error(`ghost: ${String(response.status)}`);
        const body: unknown = await response.json();
        if (
          typeof body !== "object" ||
          body === null ||
          !("matchId" in body) ||
          typeof body.matchId !== "string"
        )
          throw new Error("ghost: no match id");
        return body.matchId;
      },
      onNoGhost: () => {
        setNoGhost(true);
      },
      onOpponent: setOpponent,
    });
    live.current = run;
    return () => {
      run.stop();
      live.current = null;
    };
  }, [game, mode, rules, current]);

  const again = () => {
    setAnswered(null);
    setOpponent(null);
    setNoGhost(false);
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
          <button
            type="button"
            onClick={() => {
              setNoGhost(false);
              live.current?.ghost();
            }}
            className="mt-3 cursor-pointer self-start rounded-full border border-hairline px-5 py-2.5 font-semibold"
          >
            Play a ghost now
          </button>
          {noGhost ? (
            <p className="text-sm text-ink-muted">
              No ghost to play yet. Still looking for an opponent.
            </p>
          ) : null}
        </div>
      ) : screen.kind === "error" ? (
        <p role="alert" className="rounded-2xl bg-well px-4 py-3">
          The live match couldn&apos;t go on. Try again in a moment.
        </p>
      ) : (
        <GhostFrame label={opponent} finished={finished}>
          <View
            state={screen.state}
            answered={answered}
            onAnswer={(n, choice) => {
              if (live.current?.answer(n, choice) === true) setAnswered(n);
            }}
          />
        </GhostFrame>
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
