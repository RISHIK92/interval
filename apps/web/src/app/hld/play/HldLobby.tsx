"use client";

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

export type HldWindow = {
  at: string;
  status: WindowStatus;
  registered: boolean;
  battleMode: BattleMode | null;
  matchId: string | null;
};

export function HldLobby({
  window: initial,
  header,
  children,
}: {
  window: HldWindow;
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
  const [state, setState] = useState<"idle" | "waiting" | "solo">("idle");
  const [problem, setProblem] = useState<string | null>(null);
  const q = `?mode=${battleMode}`;

  useEffect(() => {
    if (state !== "waiting") return;
    const started = Date.now();
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
      clearInterval(timer);
    };
  }, [state, router, q]);

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
            body="An unrated 1v1, about 30 minutes. Nobody within a minute? You design alone."
          >
            <Button
              type="button"
              variant="secondary"
              disabled={state !== "idle"}
              className={LOBBY_BUTTON}
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
            </Button>
          </LobbyCard>
        </li>
        <li className="lg:order-first">
          <LobbyCard
            title="Ranked window"
            meta={windowState.status === "live" ? "Live" : "30 min"}
            art={TROPHY}
            tint="bg-(--databases-tint) text-(--databases-right)"
            body={
              windowState.status === "live"
                ? `Live now, since ${when}.`
                : `Next: ${when}. Rooms of up to 4, matched by rating.`
            }
          >
            {windowState.status === "open" ? (
              <Button
                type="button"
                variant={
                  windowState.registered &&
                  windowState.battleMode === battleMode
                    ? "secondary"
                    : "act"
                }
                className={LOBBY_BUTTON}
                onClick={() => {
                  void register(
                    !windowState.registered ||
                      windowState.battleMode !== battleMode,
                  );
                }}
              >
                {windowState.registered && windowState.battleMode === battleMode
                  ? "Cancel registration"
                  : `Register (${BATTLE_MODE_NAMES[battleMode]})`}
              </Button>
            ) : windowState.registered ? (
              <p className="text-sm font-semibold">
                You&apos;re registered; your room opens at the start.
              </p>
            ) : (
              <p className="text-sm text-ink-muted">
                Registration closed 5 minutes before.
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
