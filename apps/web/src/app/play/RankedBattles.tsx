"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { WindowStatus } from "../../server/battle-windows";
import type { BattleMode } from "../../server/ports";
import { BATTLE_MODE_NAMES } from "../battle-mode";
import { type RankedGame, setWindowRegistration } from "./windowRegistration";

const NAMES: Record<RankedGame, string> = {
  lld: "LLD",
  hld: "System design",
};
const LOBBY: Record<RankedGame, string> = {
  lld: "/play/battle",
  hld: "/hld/play",
};

// Play hub, web: the rail's ranked battles card. The next window (MATCH-7) for the
// battles on the player's plan, and their registration in each, made here as the
// lobbies make it. The card has no battle mode choice, so it registers in Human mode,
// the lobbies' default; a registration made in the lobby keeps its own mode.
export function RankedBattles({
  at,
  status,
  games,
}: {
  at: string;
  status: WindowStatus;
  games: { game: RankedGame; registered: BattleMode | null }[];
}) {
  const [registered, setRegistered] = useState(
    () =>
      new Map<RankedGame, BattleMode | null>(
        games.map((g) => [g.game, g.registered]),
      ),
  );
  const [game, setGame] = useState<RankedGame | undefined>(
    () =>
      (games.find((g) => g.registered !== null) ?? games[0])?.game ?? undefined,
  );
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  if (game === undefined) return null;
  const mine = registered.get(game) ?? null;

  const register = async (on: boolean) => {
    setProblem(null);
    setBusy(true);
    try {
      if (await setWindowRegistration(game, on, mine ?? "human"))
        setRegistered(new Map(registered).set(game, on ? "human" : null));
      else setProblem("Registration has closed for this window.");
    } catch (error: unknown) {
      console.error("play: window registration failed", error);
      setProblem("Couldn't reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      aria-label="Ranked battles"
      className="overflow-hidden rounded-[22px] border border-hairline bg-card shadow-card"
    >
      <div className="flex h-[62px] items-center justify-between bg-(--system-design-tint) px-[18px]">
        <h2 className="text-sm font-semibold text-(--system-design-line)">
          Ranked battles
        </h2>
        <svg aria-hidden="true" viewBox="0 0 54 34" className="w-[54px]">
          <path d="M14 4 26 10 14 16 2 10z" fill="var(--system-design-top)" />
          <path d="M2 10 14 16v13L2 23z" fill="var(--system-design-left)" />
          <path d="M14 16 26 10v13L14 29z" fill="var(--system-design-right)" />
          <path
            d="M32 13v16a10 3.5 0 0 0 20 0V13z"
            fill="var(--system-design-left)"
          />
          <ellipse
            cx="42"
            cy="13"
            rx="10"
            ry="3.5"
            fill="var(--system-design-top)"
          />
        </svg>
      </div>
      <div className="flex flex-col gap-3 px-[18px] pt-4 pb-[18px]">
        <Countdown at={at} />
        {games.length < 2 ? null : (
          <fieldset className="flex gap-1 rounded-xl bg-well p-1">
            <legend className="sr-only">Battle</legend>
            {games.map(({ game: g }) => (
              <label
                key={g}
                className="flex min-h-9 flex-1 cursor-pointer items-center justify-center rounded-[9px] px-2 py-1 text-center text-sm leading-tight font-semibold text-ink-soft has-checked:bg-lift has-checked:text-ink has-checked:shadow-card has-focus-visible:ring-2 has-focus-visible:ring-select"
              >
                <input
                  type="radio"
                  name="ranked-game"
                  value={g}
                  checked={g === game}
                  onChange={() => {
                    setGame(g);
                    setProblem(null);
                  }}
                  className="sr-only"
                />
                {NAMES[g]}
              </label>
            ))}
          </fieldset>
        )}
        {status === "open" ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              void register(mine === null);
            }}
            className={`flex h-11 cursor-pointer items-center justify-center rounded-xl text-[15px] font-semibold disabled:opacity-50 ${mine === null ? "bg-ink text-page" : "border-[1.5px] border-hairline-strong"}`}
          >
            {mine === null
              ? `Register for ${NAMES[game]}`
              : "Registered · cancel"}
          </button>
        ) : mine === null ? (
          <p className="rounded-xl bg-well px-3 py-2.5 text-sm text-ink-muted">
            Registration has closed.
          </p>
        ) : (
          // From its start the lobby finds the room the window grouped them into.
          <Link
            href={LOBBY[game]}
            className="flex h-11 items-center justify-center rounded-xl bg-ink text-[15px] font-semibold text-page"
          >
            {status === "live"
              ? "Go to your room"
              : "Registered · go to the lobby"}
          </Link>
        )}
        {problem === null ? null : (
          <p role="alert" className="text-[13px] text-wrong">
            {problem}
          </p>
        )}
        <p className="text-[13px] leading-snug text-ink-muted">
          Registration closes 5 minutes before it starts.
        </p>
        <p className="-mt-1.5 text-xs text-ink-muted">
          {BATTLE_MODE_NAMES[mine ?? "human"]} ·{" "}
          <Link href={LOBBY[game]} className="underline underline-offset-2">
            change in the lobby
          </Link>
        </p>
      </div>
    </section>
  );
}

// The window's start in the player's own time zone and the time left until it,
// ticking. Both depend on the browser's clock and zone, so they appear once mounted
// (the server's would differ and break hydration).
function Countdown({ at }: { at: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => {
      setNow(Date.now());
    };
    tick();
    const timer = setInterval(tick, 1_000);
    return () => {
      clearInterval(timer);
    };
  }, []);
  const start = new Date(at);
  const left = now === null ? null : Math.max(0, start.getTime() - now);
  return (
    <div>
      <p className="text-[13px] text-ink-muted">Next window</p>
      <p className="mt-0.5 min-h-6 text-[19px] leading-6 font-bold tracking-[-0.01em]">
        {now === null
          ? null
          : start.toLocaleString(undefined, {
              weekday: "long",
              hour: "numeric",
              minute: "2-digit",
            })}
      </p>
      <p className="mt-2 flex min-h-9 flex-wrap items-baseline gap-x-2">
        <span className="text-[29px] leading-9 font-bold whitespace-nowrap tabular-nums">
          {left === null ? null : left === 0 ? "On now" : clock(left)}
        </span>
        <span className="text-xs whitespace-nowrap text-ink-muted">
          {left === 0 ? "the window is live" : "until it starts"}
        </span>
      </p>
    </div>
  );
}

function clock(ms: number): string {
  const s = Math.floor(ms / 1000);
  const two = (n: number) => String(n).padStart(2, "0");
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return (
    h > 0 ? [String(h), two(m), two(s % 60)] : [String(m), two(s % 60)]
  ).join(" : ");
}
