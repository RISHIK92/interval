"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

// P5-W32 (Q-P5-19): the casual queue, which plays solo after 60 s with nobody, and the
// next ranked window: register while it's open, and from its start, poll for the
// battle the window grouped you into.
const CASUAL_WAIT_MS = 60_000;
const POLL_MS = 1000;

type Window = {
  at: string;
  status: "open" | "closed" | "live";
  registered: boolean;
  matchId: string | null;
};

function call(path: string, method: string): Promise<Response> {
  return fetch(path, {
    method,
    headers: { "content-type": "application/json" },
  });
}

export function BattleLobby({ window: initial }: { window: Window }) {
  const router = useRouter();
  const [casual, setCasual] = useState<"idle" | "waiting" | "solo">("idle");
  const [windowState, setWindow] = useState(initial);
  const [problem, setProblem] = useState<string | null>(null);

  // The casual queue: polled each second; after 60 s, out of it and into a solo battle.
  useEffect(() => {
    if (casual !== "waiting") return;
    const started = Date.now();
    let stopped = false;
    const timer = setInterval(() => {
      void (async () => {
        if (Date.now() - started >= CASUAL_WAIT_MS) {
          clearInterval(timer);
          await call("/api/battle/queue", "DELETE");
          // Leaving can't undo a match made a moment ago (the queue keeps it): one
          // last look, and solo only without one.
          const last = await call("/api/battle/queue", "PUT");
          if (last.ok) {
            const seat = (await last.json()) as {
              status: string;
              matchId?: string;
            };
            if (seat.status === "matched" && seat.matchId !== undefined) {
              if (!stopped) router.push(`/play/battle/${seat.matchId}`);
              return;
            }
          }
          setCasual("solo");
          const res = await call("/api/battle/solo", "POST");
          if (!res.ok) {
            setProblem(
              "Couldn't start a solo battle: one may be going already.",
            );
            setCasual("idle");
            return;
          }
          const { matchId } = (await res.json()) as { matchId: string };
          if (!stopped) router.push(`/play/battle/${matchId}`);
          return;
        }
        const res = await call("/api/battle/queue", "PUT");
        if (!res.ok) return;
        const state = (await res.json()) as {
          status: string;
          matchId?: string;
        };
        if (
          state.status === "matched" &&
          state.matchId !== undefined &&
          !stopped
        ) {
          clearInterval(timer);
          router.push(`/play/battle/${state.matchId}`);
        }
      })().catch((error: unknown) => {
        console.error("battle: casual queue failed", error);
      });
    }, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [casual, router]);

  // The ranked window, once live: poll for the battle it grouped us into.
  useEffect(() => {
    if (!windowState.registered || windowState.status !== "live") return;
    if (windowState.matchId !== null) {
      router.push(`/play/battle/${windowState.matchId}`);
      return;
    }
    const timer = setInterval(() => {
      call("/api/battle/window", "PUT")
        .then(async (res) => {
          if (!res.ok) return;
          const { matchId } = (await res.json()) as { matchId: string | null };
          if (matchId !== null) {
            clearInterval(timer);
            router.push(`/play/battle/${matchId}`);
          }
        })
        .catch((error: unknown) => {
          console.error("battle: window poll failed", error);
        });
    }, POLL_MS * 2);
    return () => {
      clearInterval(timer);
    };
  }, [windowState, router]);

  const startCasual = async () => {
    setProblem(null);
    const res = await call("/api/battle/queue", "POST");
    if (res.ok) setCasual("waiting");
    else setProblem("Couldn't join the queue. Try again.");
  };
  const register = async (on: boolean) => {
    setProblem(null);
    const res = await call("/api/battle/window", on ? "POST" : "DELETE");
    if (res.ok) setWindow({ ...windowState, registered: on });
    else setProblem("Registration has closed for this window.");
  };

  return (
    <BattleLobbyView
      casual={casual}
      window={windowState}
      problem={problem}
      onCasual={() => {
        void startCasual();
      }}
      onRegister={(on) => {
        void register(on);
      }}
    />
  );
}

// The lobby for a state: pure, so it can be shown in tests as it is.
export function BattleLobbyView({
  casual,
  window,
  problem,
  onCasual,
  onRegister,
}: {
  casual: "idle" | "waiting" | "solo";
  window: Window;
  problem: string | null;
  onCasual: () => void;
  onRegister: (on: boolean) => void;
}) {
  const when = new Date(window.at).toLocaleString(undefined, {
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
  return (
    <div className="flex flex-col gap-6">
      <section aria-label="Ranked window" className="flex flex-col gap-2">
        <h2 className="text-title">Ranked window</h2>
        <p className="text-ink-muted">
          {window.status === "live"
            ? `Live now, since ${when}.`
            : `Next: ${when}, 45 minutes. Rooms of up to 4, matched by rating.`}
        </p>
        {window.status === "open" ? (
          <button
            type="button"
            onClick={() => {
              onRegister(!window.registered);
            }}
            className="self-start rounded-md bg-accent px-4 py-2 text-on-accent"
          >
            {window.registered ? "Registered: cancel" : "Register"}
          </button>
        ) : window.registered ? (
          <p>
            {window.status === "live"
              ? "Finding your room…"
              : "You're registered. It starts soon."}
          </p>
        ) : (
          <p className="text-ink-muted">Registration has closed.</p>
        )}
      </section>
      <section aria-label="Casual battle" className="flex flex-col gap-2">
        <h2 className="text-title">Casual battle</h2>
        <p className="text-ink-muted">
          Unrated 1v1, any time. Nobody within a minute, and you play solo
          against the reference pace.
        </p>
        <button
          type="button"
          disabled={casual !== "idle"}
          onClick={onCasual}
          className="self-start rounded-md border border-line px-4 py-2 disabled:opacity-50"
        >
          {casual === "idle"
            ? "Find a casual battle"
            : casual === "waiting"
              ? "Looking for an opponent…"
              : "Starting solo…"}
        </button>
      </section>
      {problem !== null && (
        <p role="alert" className="text-ink-muted">
          {problem}
        </p>
      )}
    </div>
  );
}
