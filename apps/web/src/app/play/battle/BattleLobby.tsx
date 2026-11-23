"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useRef, useState } from "react";
import type { BattleMode } from "../../../server/ports";
import { BATTLE_MODE_NAMES } from "../../battle-mode";
import { BattleModeSwitch } from "../../BattleModeSwitch";
import { LOBBY_BUTTON, LobbyCard, TROPHY } from "../../LobbyCard";
import { useWindowTime } from "../../windowTime";
import { Button, buttonClass } from "../../ui/Button";
import { setWindowRegistration } from "../../play/windowRegistration";

// P5-W32 (Q-P5-19): the casual queue, which plays solo after 60 s with nobody, and the
// next ranked window: register while it's open, and from its start, poll for the
// battle the window grouped you into.
const CASUAL_WAIT_MS = 60_000;
const POLL_MS = 1000;

type Window = {
  at: string;
  status: "open" | "closed" | "live";
  registered: boolean;
  battleMode: BattleMode | null; // the one registered in
  matchId: string | null;
};

const CODE = (
  <svg
    aria-hidden="true"
    viewBox="0 0 24 24"
    className="size-[30px]"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.4"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="m8 6-6 6 6 6M16 6l6 6-6 6" />
  </svg>
);

// What went wrong, for the player: a sentence, or a solo already running (its match,
// when made: Q-P5-19 allows one at a time).
type Problem = string | { soloRunning: string | null };

function call(path: string, method: string): Promise<Response> {
  return fetch(path, {
    method,
    headers: { "content-type": "application/json" },
  });
}

export function BattleLobby({
  window: initial,
  header,
}: {
  window: Window;
  header?: ReactNode; // the page's title, which the mode choice sits beside
}) {
  const router = useRouter();
  // Navigation waits on "still on this page", not on the effect that asked: saying
  // "solo" re-runs that effect, and its cleanup would drop the solo match's navigation.
  const onPage = useRef(true);
  useEffect(() => {
    onPage.current = true;
    return () => {
      onPage.current = false;
    };
  }, []);
  const [casual, setCasual] = useState<"idle" | "waiting" | "solo">("idle");
  const [windowState, setWindow] = useState(initial);
  const [problem, setProblem] = useState<Problem | null>(null);
  // P5-W33 (§6.2, Q-P5-20): which battle mode the queue and registration are for.
  const [battleMode, setBattleMode] = useState<BattleMode>(
    initial.battleMode ?? "human",
  );
  const q = `?mode=${battleMode}`;

  // The casual queue: polled each second; after 60 s, out of it and into a solo battle.
  useEffect(() => {
    if (casual !== "waiting") return;
    const started = Date.now();
    const timer = setInterval(() => {
      void (async () => {
        if (Date.now() - started >= CASUAL_WAIT_MS) {
          clearInterval(timer);
          await call(`/api/battle/queue${q}`, "DELETE");
          // Leaving can't undo a match made a moment ago (the queue keeps it): one
          // last look, and solo only without one.
          const last = await call(`/api/battle/queue${q}`, "PUT");
          if (last.ok) {
            const seat = (await last.json()) as {
              status: string;
              matchId?: string;
            };
            if (seat.status === "matched" && seat.matchId !== undefined) {
              if (onPage.current) router.push(`/play/battle/${seat.matchId}`);
              return;
            }
          }
          setCasual("solo");
          const res = await call(`/api/battle/solo${q}`, "POST");
          if (res.status === 429) {
            const { matchId } = (await res.json()) as {
              matchId: string | null;
            };
            setProblem({ soloRunning: matchId });
            setCasual("idle");
            return;
          }
          if (!res.ok) {
            setProblem("Couldn't start a solo battle. Try again.");
            setCasual("idle");
            return;
          }
          const { matchId } = (await res.json()) as { matchId: string };
          if (onPage.current) router.push(`/play/battle/${matchId}`);
          return;
        }
        const res = await call(`/api/battle/queue${q}`, "PUT");
        if (!res.ok) return;
        const state = (await res.json()) as {
          status: string;
          matchId?: string;
        };
        if (
          state.status === "matched" &&
          state.matchId !== undefined &&
          onPage.current
        ) {
          clearInterval(timer);
          router.push(`/play/battle/${state.matchId}`);
        }
      })().catch((error: unknown) => {
        console.error("battle: casual queue failed", error);
      });
    }, POLL_MS);
    return () => {
      clearInterval(timer);
    };
  }, [casual, router, q]);

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
    const res = await call(`/api/battle/queue${q}`, "POST");
    if (res.ok) setCasual("waiting");
    else setProblem("Couldn't join the queue. Try again.");
  };
  const register = async (on: boolean) => {
    setProblem(null);
    if (await setWindowRegistration("lld", on, battleMode))
      setWindow({
        ...windowState,
        registered: on,
        battleMode: on ? battleMode : null,
      });
    else setProblem("Registration has closed for this window.");
  };

  return (
    <BattleLobbyView
      header={header}
      casual={casual}
      window={windowState}
      problem={problem}
      battleMode={battleMode}
      onBattleMode={setBattleMode}
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
  header,
  casual,
  window,
  problem,
  battleMode,
  onBattleMode,
  onCasual,
  onRegister,
}: {
  header?: ReactNode;
  casual: "idle" | "waiting" | "solo";
  window: Window;
  problem: Problem | null;
  battleMode: BattleMode;
  onBattleMode: (battleMode: BattleMode) => void;
  onCasual: () => void;
  onRegister: (on: boolean) => void;
}) {
  const when = useWindowTime(window.at) ?? "…";
  return (
    <div className="flex flex-col gap-4 lg:gap-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between lg:gap-6">
        {header}
        {/* §6.2: the human mode is you alone; the AI mode allows any tools. */}
        <BattleModeSwitch
          value={battleMode}
          details={{ human: "no AI tools", ai: "any tools, bigger problems" }}
          disabled={casual !== "idle"}
          onChange={onBattleMode}
          className="lg:w-72 lg:shrink-0"
        />
      </div>
      <ul className="grid gap-3 sm:grid-cols-2 lg:gap-3.5">
        <li>
          <LobbyCard
            title="Ranked window"
            meta={window.status === "live" ? "Live" : "45 min"}
            art={TROPHY}
            tint="bg-(--databases-tint) text-(--databases-right)"
            body={
              window.status === "live"
                ? `Live now, since ${when}.`
                : `Next: ${when}, 45 minutes. Rooms of up to 4, matched by rating.`
            }
          >
            {window.status === "open" ? (
              <Button
                type="button"
                onClick={() => {
                  onRegister(
                    !window.registered || window.battleMode !== battleMode,
                  );
                }}
                variant={
                  window.registered && window.battleMode === battleMode
                    ? "secondary"
                    : "act"
                }
                className={LOBBY_BUTTON}
              >
                {window.registered
                  ? window.battleMode === battleMode
                    ? "Registered: cancel"
                    : `Switch to ${BATTLE_MODE_NAMES[battleMode]}`
                  : "Register"}
              </Button>
            ) : window.registered ? (
              <p className="text-sm font-semibold">
                {window.status === "live"
                  ? "Finding your room…"
                  : "You're registered. It starts soon."}
              </p>
            ) : (
              <p className="text-sm text-ink-muted">Registration has closed.</p>
            )}
          </LobbyCard>
        </li>
        <li>
          <LobbyCard
            title="Casual battle"
            meta="Unrated"
            art={CODE}
            tint="bg-(--distributed-systems-tint) text-(--distributed-systems-right)"
            body="Unrated 1v1, any time. Nobody within a minute, and you play solo against the reference pace."
          >
            <Button
              type="button"
              variant="secondary"
              disabled={casual !== "idle"}
              onClick={onCasual}
              className={LOBBY_BUTTON}
            >
              {casual === "idle"
                ? "Find a match"
                : casual === "waiting"
                  ? "Looking for an opponent…"
                  : "Starting solo…"}
            </Button>
          </LobbyCard>
        </li>
        {/* ADR-0048 (Q-WD-28): practice problems, apart from every battle pool. */}
        <li>
          <LobbyCard
            title="Practice"
            meta="No clock, unrated"
            art={CODE}
            tint="bg-(--system-design-tint) text-(--system-design-line)"
            body="Run and submit against the full tests, and reveal the extension when you're ready."
          >
            <Link
              href="/play/battle/practice"
              className={`${buttonClass("secondary")} ${LOBBY_BUTTON}`}
            >
              Practice
            </Link>
          </LobbyCard>
        </li>
      </ul>
      {problem !== null && (
        <p role="alert" className="rounded-2xl bg-well px-4 py-3 text-sm">
          {typeof problem === "string" ? (
            problem
          ) : problem.soloRunning === null ? (
            "You already have a solo battle starting. Try again in a minute."
          ) : (
            <>
              You already have a solo battle running.{" "}
              <Link
                href={`/play/battle/${problem.soloRunning}`}
                className="font-semibold underline underline-offset-2"
              >
                Go back to it
              </Link>
            </>
          )}
        </p>
      )}
    </div>
  );
}
