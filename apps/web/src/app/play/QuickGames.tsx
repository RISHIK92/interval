"use client";

import { type ReactElement, type ReactNode, useState } from "react";

export type QuickGame = {
  name: string;
  format: string;
  about: string;
  icon: ReactNode;
  tint: string; // the tile's icon square
  panel: string; // the chosen game's panel
  art: ReactNode;
  // The ways in, made on the server; a game with neither shows its note.
  solo: ReactElement | null;
  live: ReactElement | null;
  note: string;
};

// Play hub, web: pick a quick game, then how to play it, then play. Both choices are
// radio groups (hidden inputs under the drawn tiles and segments), so arrow keys and
// screen readers work as for any radios. Only the chosen game's way in is shown.
export function QuickGames({ games }: { games: QuickGame[] }) {
  const [chosen, setChosen] = useState(0);
  const [mode, setMode] = useState<"solo" | "live">("solo");
  const game = games[chosen];
  if (game === undefined) return null;
  const both = game.solo !== null && game.live !== null;
  const way = game.solo === null ? "live" : game.live === null ? "solo" : mode;
  const action = way === "solo" ? game.solo : game.live;
  return (
    <div className="flex flex-col gap-4">
      <fieldset className="grid grid-cols-3 gap-2.5">
        <legend className="sr-only">Quick game</legend>
        {games.map((g, i) => (
          <label
            key={g.name}
            className="flex cursor-pointer items-center gap-3 rounded-2xl border-2 border-hairline px-3.5 py-3 has-checked:border-ink has-focus-visible:ring-2 has-focus-visible:ring-select has-focus-visible:ring-offset-2"
          >
            <input
              type="radio"
              name="quick-game"
              value={g.name}
              checked={i === chosen}
              onChange={() => {
                setChosen(i);
              }}
              className="sr-only"
            />
            <span
              className={`flex size-9 shrink-0 items-center justify-center rounded-[10px] ${g.tint}`}
            >
              {g.icon}
            </span>
            <span className="min-w-0">
              <span className="block text-[15px] leading-tight font-semibold">
                {g.name}
              </span>
              <span className="mt-0.5 block text-xs text-ink-muted">
                {g.format}
              </span>
            </span>
          </label>
        ))}
      </fieldset>
      <div
        className={`flex min-h-[121px] items-center gap-5 rounded-[18px] py-4 pr-5 pl-2 ${game.panel}`}
      >
        <span className="flex w-[130px] shrink-0 justify-center">
          {game.art}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[21px] leading-tight font-bold tracking-[-0.01em]">
            {game.name}
          </h3>
          <p className="mt-1 text-[15px] leading-snug text-ink-soft">
            {game.about}
          </p>
        </div>
        {both ? (
          <fieldset className="flex shrink-0 gap-1 rounded-xl bg-page p-1">
            <legend className="sr-only">How to play</legend>
            {(
              [
                ["solo", "Solo"],
                ["live", "1v1 live"],
              ] as const
            ).map(([value, label]) => (
              <label
                key={value}
                className="flex h-8 cursor-pointer items-center rounded-[9px] px-3.5 text-sm font-semibold text-ink-soft has-checked:bg-track has-checked:text-ink has-focus-visible:ring-2 has-focus-visible:ring-select"
              >
                <input
                  type="radio"
                  name="quick-mode"
                  value={value}
                  checked={mode === value}
                  onChange={() => {
                    setMode(value);
                  }}
                  className="sr-only"
                />
                {label}
              </label>
            ))}
          </fieldset>
        ) : null}
        {action ?? (
          <p className="max-w-40 shrink-0 text-sm text-ink-muted">
            {game.note}
          </p>
        )}
      </div>
    </div>
  );
}
