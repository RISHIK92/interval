import Link from "next/link";
import type { ReactNode } from "react";

// The design's five tabs (ADR-0017). Home, Paths (P2-W10-S03), Play (P3-W13-S01) and
// Library work; Explore arrives with its phase and shows disabled until then. On wide screens the bar is
// the design's sidebar (ADR-0019): the wordmark, Leagues (web only, disabled) and the
// profile at the bottom; on phones Profile is reached from the header (Q-P1-19).
type Current = "home" | "library" | "paths" | "play";

const icon = (path: ReactNode) => (
  <svg
    aria-hidden="true"
    viewBox="0 0 24 24"
    className="size-6"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {path}
  </svg>
);

const ICONS = {
  home: icon(
    <path d="M4 11l8-7 8 7v8a1 1 0 0 1-1 1h-4v-6h-6v6H5a1 1 0 0 1-1-1z" />,
  ),
  explore: icon(
    <>
      <circle cx="11" cy="11" r="6" />
      <path d="M20 20l-4.5-4.5" />
    </>,
  ),
  paths: icon(
    <>
      <circle cx="6" cy="6" r="2" />
      <circle cx="18" cy="18" r="2" />
      <path d="M8 6h7a3 3 0 0 1 0 6H9a3 3 0 0 0 0 6h7" />
    </>,
  ),
  play: icon(<path d="M13 3L5 14h6l-1 7 8-11h-6z" />),
  leagues: icon(
    <path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M9 20h6M10 17h4" />,
  ),
  profile: icon(
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </>,
  ),
  library: icon(
    <>
      <path d="M5 4v16M9 4v16" />
      <path d="M13 5l4 15" />
    </>,
  ),
};

// A tab under an icon on phones; an icon and its name in a row in the sidebar.
const TAB =
  "flex flex-1 flex-col items-center gap-1 py-2 text-xs lg:flex-none lg:flex-row lg:gap-3 lg:rounded-xl lg:px-3 lg:py-2.5 lg:text-base";

function Live(props: {
  href: string;
  name: string;
  current: boolean;
  icon: ReactNode;
}) {
  return (
    <Link
      href={props.href}
      aria-current={props.current ? "page" : undefined}
      className={`${TAB} ${props.current ? "font-semibold text-ink lg:bg-well" : "text-ink-muted"}`}
    >
      {props.icon}
      {props.name}
    </Link>
  );
}

function Later(props: { name: string; icon: ReactNode; wideOnly?: boolean }) {
  return (
    <span
      aria-disabled="true"
      className={`${TAB} ${props.wideOnly === true ? "hidden lg:flex " : ""}cursor-not-allowed text-ink-muted opacity-40`}
    >
      {props.icon}
      {props.name}
      <span className="sr-only">Coming later</span>
    </span>
  );
}

export function TabBar({
  current,
  firstName,
}: {
  current: Current;
  firstName: string | null;
}) {
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-10 flex border-t border-hairline bg-page pb-[env(safe-area-inset-bottom)] lg:inset-y-0 lg:right-auto lg:w-60 lg:flex-col lg:gap-1 lg:border-t-0 lg:border-r lg:px-3 lg:py-6"
    >
      <span className="mb-6 hidden items-center gap-2 px-3 text-title lg:flex">
        <span
          aria-hidden="true"
          className="flex size-8 items-center justify-center rounded-lg bg-ink text-page"
        >
          I
          <span className="size-1.5 rounded-full bg-go" />
        </span>
        Interval
      </span>
      <Live
        href="/"
        name="Home"
        current={current === "home"}
        icon={ICONS.home}
      />
      <Later name="Explore" icon={ICONS.explore} />
      <Live
        href="/paths"
        name="Paths"
        current={current === "paths"}
        icon={ICONS.paths}
      />
      <Live
        href="/play"
        name="Play"
        current={current === "play"}
        icon={ICONS.play}
      />
      <Later name="Leagues" icon={ICONS.leagues} wideOnly />
      <Live
        href="/library"
        name="Library"
        current={current === "library"}
        icon={ICONS.library}
      />
      <Link
        href="/profile"
        className="mt-auto hidden items-center gap-3 rounded-xl px-3 py-2.5 text-ink-muted hover:bg-well lg:flex"
      >
        {/* The design's profile row: an initial and the name (owner, 2026-10-26). */}
        {firstName === null ? (
          ICONS.profile
        ) : (
          <span
            aria-hidden="true"
            className="flex size-9 shrink-0 items-center justify-center rounded-full bg-well font-semibold text-select"
          >
            {firstName.charAt(0).toUpperCase()}
          </span>
        )}
        <span className="flex flex-col leading-tight">
          {firstName === null ? null : (
            <span className="font-semibold text-ink">{firstName}</span>
          )}
          <span className="text-sm">Profile and settings</span>
        </span>
      </Link>
    </nav>
  );
}
