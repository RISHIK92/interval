import type { ReactNode } from "react";
import { Card } from "./ui/Card";

// A battle lobby's way in (the ranked window, the casual queue), drawn as the Play hub's
// battle cards (Play hub, web): a tinted art tile beside the title, what it is, and its
// action. Phones drop the tile, as the hub does.
export function LobbyCard({
  title,
  meta,
  art,
  tint,
  body,
  live = false,
  children,
}: {
  title: string;
  meta?: string; // the corner chip: a duration, "Live"
  live?: boolean; // the chip in the live colour, with its dot
  art: ReactNode;
  tint: string; // the tile's background (and colour), from a topic ramp
  body: ReactNode;
  children: ReactNode; // the action, or what the state allows instead
}) {
  return (
    <section aria-label={title} className="h-full">
      <Card className="flex h-full flex-col gap-2 p-5 lg:flex-row lg:items-start lg:gap-4 lg:rounded-[22px] lg:p-[18px] lg:shadow-none">
        <span
          className={`hidden size-16 shrink-0 items-center justify-center rounded-2xl lg:flex ${tint}`}
        >
          {art}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-2 lg:self-stretch">
          <div className="flex items-start justify-between gap-3">
            <h2 className="text-title lg:text-section lg:tracking-normal">
              {title}
            </h2>
            {meta === undefined ? null : (
              <span
                className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold tabular-nums ${live ? "bg-live/15 text-live" : "bg-well text-ink-muted"}`}
              >
                {live ? (
                  <span
                    aria-hidden="true"
                    className="size-1.5 rounded-full bg-live motion-safe:animate-pulse"
                  />
                ) : null}
                {meta}
              </span>
            )}
          </div>
          <div className="text-sm text-ink-muted">{body}</div>
          <div className="mt-auto flex flex-wrap items-center gap-2 pt-2 lg:pt-1">
            {children}
          </div>
        </div>
      </Card>
    </section>
  );
}

// The Play hub's button sizes: the pill on phones, the design's 40 px, 12 px-radius
// button on wide screens.
export const LOBBY_BUTTON = "lg:rounded-xl lg:px-4 lg:py-2 lg:text-sm";

// The cards' art: a trophy for ranked play; the system design cube (the Play hub's).
export const TROPHY = (
  <svg
    aria-hidden="true"
    viewBox="0 0 24 24"
    className="size-[30px]"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3" />
  </svg>
);

export const CUBE = (
  <svg aria-hidden="true" viewBox="0 0 40 40" className="size-11">
    <path d="M20 6 32 12 20 18 8 12z" fill="var(--system-design-top)" />
    <path d="M8 12 20 18v14L8 26z" fill="var(--system-design-left)" />
    <path d="M20 18 32 12v14L20 32z" fill="var(--system-design-right)" />
  </svg>
);
