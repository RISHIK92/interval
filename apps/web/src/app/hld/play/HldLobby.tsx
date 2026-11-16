"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { League } from "../../../server/ports";

// P6-W42 (MATCH-7, §6.2; Q-P6-06): the casual HLD queue: an unrated 1v1, polled each
// second; after 60 s unmatched, a solo match instead.
const POLL_MS = 1_000;
const CASUAL_WAIT_MS = 60_000;

const call = (url: string, method: string) =>
  fetch(url, { method, headers: { "content-type": "application/json" } });

export function HldLobby() {
  const router = useRouter();
  const [league, setLeague] = useState<League>("human");
  const [state, setState] = useState<"idle" | "waiting" | "solo">("idle");
  const [problem, setProblem] = useState<string | null>(null);
  const q = `?league=${league}`;

  useEffect(() => {
    if (state !== "waiting") return;
    const started = Date.now();
    let stopped = false;
    const go = (id: string) => {
      if (!stopped) router.push(`/hld/match/${id}`);
    };
    const timer = setInterval(() => {
      void (async () => {
        if (Date.now() - started >= CASUAL_WAIT_MS) {
          clearInterval(timer);
          await call(`/api/hld/queue${q}`, "DELETE");
          // Leaving can't undo a match made a moment ago: one last look first.
          const last = await call(`/api/hld/queue${q}`, "PUT");
          if (last.ok) {
            const seat = (await last.json()) as {
              status: string;
              matchId?: string;
            };
            if (seat.status === "matched" && seat.matchId !== undefined) {
              go(seat.matchId);
              return;
            }
          }
          setState("solo");
          const res = await call(`/api/hld/solo${q}`, "POST");
          if (!res.ok) {
            setProblem(
              "Couldn't start a solo match: one may be going already.",
            );
            setState("idle");
            return;
          }
          go(((await res.json()) as { matchId: string }).matchId);
          return;
        }
        const res = await call(`/api/hld/queue${q}`, "PUT");
        if (!res.ok) return;
        const seat = (await res.json()) as { status: string; matchId?: string };
        if (seat.status === "matched" && seat.matchId !== undefined) {
          clearInterval(timer);
          go(seat.matchId);
        }
      })().catch((error: unknown) => {
        console.error("hld: casual queue failed", error);
      });
    }, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [state, router, q]);

  return (
    <div className="flex flex-col gap-4">
      <fieldset
        disabled={state !== "idle"}
        className="flex flex-wrap items-center gap-3"
      >
        <legend className="sr-only">League</legend>
        {(["human", "ai"] as const).map((l) => (
          <label key={l} className="flex items-center gap-2">
            <input
              type="radio"
              name="league"
              value={l}
              checked={league === l}
              onChange={() => {
                setLeague(l);
              }}
            />
            {l === "human"
              ? "Human league: no AI tools"
              : "AI league: any tools, bigger problems, a lost region"}
          </label>
        ))}
      </fieldset>
      <button
        type="button"
        disabled={state !== "idle"}
        className="self-start rounded-md bg-accent px-4 py-2 text-on-accent disabled:opacity-50"
        onClick={() => {
          setProblem(null);
          void call(`/api/hld/queue${q}`, "POST").then((res) => {
            if (res.ok) setState("waiting");
            else setProblem("Couldn't join the queue. Try again.");
          });
        }}
      >
        {state === "idle"
          ? "Find an opponent"
          : state === "waiting"
            ? "Looking for an opponent…"
            : "Starting a solo match…"}
      </button>
      <p className="text-sm text-ink-muted">
        An unrated 1v1, about 30 minutes. Nobody within a minute? You design
        alone.
      </p>
      {problem === null ? null : <p role="alert">{problem}</p>}
    </div>
  );
}
