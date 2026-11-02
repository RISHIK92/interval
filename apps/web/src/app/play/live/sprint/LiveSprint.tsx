"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { openMatch } from "../join";
import { runSprint } from "../sprint-client";
import type { SprintState } from "../sprint-state";
import { SprintView } from "./SprintView";

type Screen =
  | { kind: "queue"; since: number }
  | { kind: "match"; state: SprintState }
  | { kind: "error" };

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

// P3-W16-S04 (Q-P3-23): the live 1v1 sprint. Queue (join, poll about once a second,
// leave when the screen goes), then the match over the game server's socket, then the
// result. Play again queues afresh.
export function LiveSprint() {
  const [screen, setScreen] = useState<Screen>(() => ({
    kind: "queue",
    since: Date.now(),
  }));
  const [answered, setAnswered] = useState<number | null>(null);
  const [game, setGame] = useState(0);
  const sprint = useRef<ReturnType<typeof runSprint> | null>(null);

  useEffect(() => {
    const run = runSprint({
      queue: (method) =>
        fetch("/api/game/queue?mode=sprint", {
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
        // A new question takes answers again.
        if (state.phase === "playing")
          setAnswered((n) => (n === state.question?.n ? n : null));
        setScreen({ kind: "match", state });
      },
      onError: () => {
        setScreen({ kind: "error" });
      },
    });
    sprint.current = run;
    return () => {
      run.stop();
      sprint.current = null;
    };
  }, [game]);

  const again = () => {
    setAnswered(null);
    setScreen({ kind: "queue", since: Date.now() });
    setGame((n) => n + 1);
  };
  const finished =
    screen.kind === "match" &&
    (screen.state.phase === "final" || screen.state.phase === "cancelled");

  return (
    <div className="flex flex-col gap-6">
      {screen.kind === "queue" ? (
        <div role="status" className="flex flex-col gap-1">
          <p className="text-lg font-semibold">Finding an opponent…</p>
          <p className="text-sm text-ink-muted tabular-nums">
            Waiting <Waited since={screen.since} />
            s, matched by rating.
          </p>
        </div>
      ) : screen.kind === "error" ? (
        <p role="alert" className="rounded-2xl bg-well px-4 py-3">
          The live match couldn&apos;t go on. Try again in a moment.
        </p>
      ) : (
        <SprintView
          state={screen.state}
          answered={answered}
          onAnswer={(n, choice) => {
            if (sprint.current?.answer(n, choice) === true) setAnswered(n);
          }}
        />
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
