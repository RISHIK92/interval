"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useRef, useState } from "react";
import type { WindowStatus } from "../../../server/battle-windows";
import type { BattleMode } from "../../../server/ports";
import { BATTLE_MODE_NAMES } from "../../battle-mode";
import { BattleModeSwitch } from "../../BattleModeSwitch";
import { CUBE, LOBBY_BUTTON, LobbyCard, TROPHY } from "../../LobbyCard";
import { useWindowTime } from "../../windowTime";
import { Button } from "../../ui/Button";
import { setWindowRegistration } from "../../play/windowRegistration";

// P6-W42 (MATCH-7, §6.2; Q-P6-06): the casual HLD queue (an unrated 1v1, polled each
// second; after 60 s unmatched, a solo match instead) and the next ranked window (rooms
// of up to 4 by HLD rating, at LLD's times, registered apart).
const POLL_MS = 1_000;
const CASUAL_WAIT_MS = 60_000;

const call = (url: string, method: string) =>
  fetch(url, { method, headers: { "content-type": "application/json" } });

// The wait so far, as m:ss.
function clock(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60))}:${String(s % 60).padStart(2, "0")}`;
}

export type HldWindow = {
  at: string;
  status: WindowStatus;
  registered: boolean;
  battleMode: BattleMode | null;
  matchId: string | null;
};

export function HldLobby({
  window: initial,
  openMatch = null,
  header,
  children,
}: {
  window: HldWindow;
  // The player's match still being played, if any: where a refused solo leads.
  openMatch?: { id: string; deadline: string } | null;
  header?: ReactNode; // the page's title, which the mode choice sits beside
  children?: ReactNode; // more ways in (practice, tournaments), as list items
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
  const [battleMode, setBattleMode] = useState<BattleMode>(
    initial.battleMode ?? "human",
  );
  const [windowState, setWindow] = useState(initial);
  const [state, setState] = useState<"idle" | "waiting" | "solo" | "refused">(
    "idle",
  );
  const [problem, setProblem] = useState<string | null>(null);
  const q = `?mode=${battleMode}`;

  // When the player joined the queue, and the clock's last tick: the wait shown on the
  // card, against the minute after which they design alone.
  const [joinedAt, setJoinedAt] = useState<number | null>(null);
  const cancelled = useRef(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (state !== "waiting") return;
    const timer = setInterval(() => {
      setTick(Date.now());
    }, 1_000);
    return () => {
      clearInterval(timer);
    };
  }, [state]);

  useEffect(() => {
    if (state !== "waiting") return;
    const started = joinedAt ?? Date.now();
    const go = (id: string) => {
      if (onPage.current) router.push(`/hld/match/${id}`);
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
          // Cancelled meanwhile: a tick already under way mustn't start the solo match.
          if (cancelled.current) return;
          setState("solo");
          const res = await call(`/api/hld/solo${q}`, "POST");
          if (res.status === 429) {
            // One solo at a time (claimSolo): say why, and where to go instead.
            setState("refused");
            return;
          }
          if (!res.ok) {
            setProblem("Couldn't start a solo match. Try again.");
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
      clearInterval(timer);
    };
  }, [state, router, q, joinedAt]);

  // Leaving the queue; a match made a moment before still opens, as it can't be undone.
  const cancel = async () => {
    cancelled.current = true;
    setState("idle");
    setJoinedAt(null);
    await call(`/api/hld/queue${q}`, "DELETE");
    const last = await call(`/api/hld/queue${q}`, "PUT");
    if (!last.ok) return;
    const seat = (await last.json()) as { status: string; matchId?: string };
    if (
      seat.status === "matched" &&
      seat.matchId !== undefined &&
      onPage.current
    )
      router.push(`/hld/match/${seat.matchId}`);
  };
  const waited =
    joinedAt === null
      ? 0
      : Math.max(0, Math.min(tick, joinedAt + CASUAL_WAIT_MS) - joinedAt);

  // The ranked window, once live: poll for the match it grouped us into.
  useEffect(() => {
    if (!windowState.registered || windowState.status !== "live") return;
    if (windowState.matchId !== null) {
      router.push(`/hld/match/${windowState.matchId}`);
      return;
    }
    const timer = setInterval(() => {
      call("/api/hld/window", "PUT")
        .then(async (res) => {
          if (!res.ok) return;
          const { matchId } = (await res.json()) as { matchId: string | null };
          if (matchId !== null) {
            clearInterval(timer);
            router.push(`/hld/match/${matchId}`);
          }
        })
        .catch((error: unknown) => {
          console.error("hld: window poll failed", error);
        });
    }, POLL_MS * 2);
    return () => {
      clearInterval(timer);
    };
  }, [windowState, router]);

  const register = async (on: boolean) => {
    setProblem(null);
    if (await setWindowRegistration("hld", on, battleMode))
      setWindow({
        ...windowState,
        registered: on,
        battleMode: on ? battleMode : null,
      });
    else setProblem("Registration is closed for this window.");
  };
  const when = useWindowTime(windowState.at) ?? "…";

  return (
    <div className="flex flex-col gap-4 lg:gap-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between lg:gap-6">
        {header}
        <BattleModeSwitch
          value={battleMode}
          details={{
            human: "no AI tools",
            ai: "any tools, bigger problems, a lost region",
          }}
          disabled={state !== "idle"}
          onChange={setBattleMode}
          className="lg:w-72 lg:shrink-0"
        />
      </div>
      {/* Phones keep the order from before the web design (casual, then ranked);
          the wide grid leads with the ranked window, as the design does. */}
      <ul className="grid gap-3 sm:grid-cols-2 lg:gap-3.5">
        <li>
          <LobbyCard
            title="Casual battle"
            meta="Unrated"
            art={CUBE}
            tint="bg-(--system-design-tint)"
            body={
              <div
                role="status"
                className="flex min-h-[4.25rem] flex-col gap-2"
              >
                {state === "idle" ? (
                  <p>
                    An unrated 1v1, about 30 minutes. Nobody within a minute?
                    You design alone.
                  </p>
                ) : state === "waiting" ? (
                  <>
                    <p className="flex items-baseline justify-between gap-3 font-semibold text-ink">
                      Looking for an opponent…
                      <span aria-hidden="true" className="tabular-nums">
                        {clock(waited)}
                      </span>
                    </p>
                    <span
                      aria-hidden="true"
                      className="block h-1.5 overflow-hidden rounded-full bg-track"
                    >
                      <span
                        className="block h-full rounded-full bg-go transition-[width] duration-1000 ease-linear"
                        style={{
                          width: `${String((waited / CASUAL_WAIT_MS) * 100)}%`,
                        }}
                      />
                    </span>
                    <p>Nobody by 1:00? You&apos;ll design solo instead.</p>
                  </>
                ) : state === "solo" ? (
                  <p className="font-semibold text-ink">
                    Nobody came: starting your solo match…
                  </p>
                ) : (
                  <>
                    <p className="font-semibold text-ink">
                      Nobody came, and a solo match can&apos;t start yet.
                    </p>
                    <p>
                      {openMatch === null
                        ? "You've started a solo match in the last 30 minutes: one at a time. Try for an opponent again, or practice meanwhile."
                        : `You have a match going until ${new Date(openMatch.deadline).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}: finish it first, or try for an opponent again.`}
                    </p>
                  </>
                )}
              </div>
            }
          >
            {state === "refused" && openMatch !== null ? (
              <Link
                href={`/hld/match/${openMatch.id}`}
                className={`inline-flex items-center justify-center rounded-full bg-ink px-5 py-2.5 font-semibold text-page ${LOBBY_BUTTON}`}
              >
                Open your match
              </Link>
            ) : null}
            {state === "idle" || state === "refused" ? (
              <Button
                type="button"
                variant="secondary"
                className={LOBBY_BUTTON}
                onClick={() => {
                  setProblem(null);
                  void call(`/api/hld/queue${q}`, "POST").then((res) => {
                    if (res.ok) {
                      const now = Date.now();
                      cancelled.current = false;
                      setJoinedAt(now);
                      setTick(now);
                      setState("waiting");
                    } else setProblem("Couldn't join the queue. Try again.");
                  });
                }}
              >
                Find a match
              </Button>
            ) : (
              <Button
                type="button"
                variant="secondary"
                disabled={state !== "waiting"}
                className={LOBBY_BUTTON}
                onClick={() => {
                  void cancel().catch((error: unknown) => {
                    console.error("hld: leaving the queue failed", error);
                    setProblem("Couldn't leave the queue. Reload the page.");
                  });
                }}
              >
                Cancel
              </Button>
            )}
            {state === "refused" && openMatch === null ? (
              <Link
                href="/hld/practice"
                className="px-2 text-sm font-semibold text-ink-muted underline-offset-2 hover:underline"
              >
                Practice
              </Link>
            ) : null}
          </LobbyCard>
        </li>
        <li className="lg:order-first">
          <LobbyCard
            title="Ranked window"
            meta={windowState.status === "live" ? "Live" : "30 min"}
            live={windowState.status === "live"}
            art={TROPHY}
            tint="bg-(--databases-tint) text-(--databases-right)"
            body={
              windowState.status === "live"
                ? `Live now, since ${when}.`
                : `Next: ${when}. Rooms of up to 4, matched by rating.`
            }
          >
            {windowState.status === "open" ? (
              windowState.registered &&
              windowState.battleMode === battleMode ? (
                <>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-go-soft px-3 py-1.5 text-sm font-semibold text-go-text">
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 24 24"
                      className="size-4"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.4"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="m5 12 5 5 9-10" />
                    </svg>
                    Registered · {BATTLE_MODE_NAMES[battleMode]}
                  </span>
                  <Button
                    type="button"
                    variant="secondary"
                    className={LOBBY_BUTTON}
                    onClick={() => {
                      void register(false);
                    }}
                  >
                    Cancel registration
                  </Button>
                </>
              ) : (
                <span className="flex flex-col items-start gap-1">
                  <Button
                    type="button"
                    aria-describedby="hld-register-mode"
                    className={LOBBY_BUTTON}
                    onClick={() => {
                      void register(true);
                    }}
                  >
                    Register
                  </Button>
                  <span
                    id="hld-register-mode"
                    className="text-[13px] text-ink-muted"
                  >
                    {windowState.registered
                      ? `Switches your registration to ${BATTLE_MODE_NAMES[battleMode]}`
                      : `In ${BATTLE_MODE_NAMES[battleMode]}`}
                  </span>
                </span>
              )
            ) : windowState.registered ? (
              <p role="status" className="text-sm font-semibold">
                {windowState.status === "live"
                  ? "You're registered: opening your room…"
                  : "You're registered; your room opens at the start."}
              </p>
            ) : (
              <p className="text-sm text-ink-muted">
                Registration closed 5 minutes before the start.
              </p>
            )}
          </LobbyCard>
        </li>
        {children}
      </ul>
      {problem === null ? null : (
        <p role="alert" className="rounded-2xl bg-well px-4 py-3 text-sm">
          {problem}
        </p>
      )}
    </div>
  );
}
