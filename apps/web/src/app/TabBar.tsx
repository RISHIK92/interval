import Link from "next/link";
import type { ReactNode } from "react";

// The design's five tabs (ADR-0017). Home, Paths (P2-W10-S03), Play (P3-W13-S01) and
// Library work; Explore arrives with its phase and shows disabled until then. On wide screens the bar is
// the design's sidebar (ADR-0019): the wordmark, Leagues (web only, disabled) and the
// profile at the bottom; on phones Profile is reached from the header (Q-P1-19).
// "profile" marks the sidebar's profile row; null, a page that is none of them.
type Current = "home" | "library" | "paths" | "play" | "profile";

// Phones keep the mobile design's glyphs; the web sidebar draws the web design's, a
// little smaller and bolder.
const icon = (phone: ReactNode, wide: ReactNode = phone) => (
  <>
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="size-6 lg:hidden"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {phone}
    </svg>
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="hidden size-[19px] shrink-0 lg:block"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {wide}
    </svg>
  </>
);

const ICONS = {
  home: icon(
    <path d="M4 11l8-7 8 7v8a1 1 0 0 1-1 1h-4v-6h-6v6H5a1 1 0 0 1-1-1z" />,
    <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />,
  ),
  explore: icon(
    <>
      <circle cx="11" cy="11" r="6" />
      <path d="M20 20l-4.5-4.5" />
    </>,
    <path d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-4.5-4.5" />,
  ),
  paths: icon(
    <>
      <circle cx="6" cy="6" r="2" />
      <circle cx="18" cy="18" r="2" />
      <path d="M8 6h7a3 3 0 0 1 0 6H9a3 3 0 0 0 0 6h7" />
    </>,
    <path d="M6 21a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM8 19h8.5a3.5 3.5 0 0 0 0-7h-9a3.5 3.5 0 0 1 0-7H16" />,
  ),
  play: icon(
    <path d="M13 3L5 14h6l-1 7 8-11h-6z" />,
    <path d="M13 2 4 14h7l-1 8 9-12h-7z" />,
  ),
  leagues: icon(
    <path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M9 20h6M10 17h4" />,
    <path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM7 6H4v2a3 3 0 0 0 3 3M17 6h3v2a3 3 0 0 1-3 3" />,
  ),
  library: icon(
    <>
      <path d="M5 4v16M9 4v16" />
      <path d="M13 5l4 15" />
    </>,
    <path d="M4 4h4v16H4zM10 4h4v16h-4zM16 5l3.6-1 3 15.2-3.6 1z" />,
  ),
};

const PROFILE = (
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
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21a8 8 0 0 1 16 0" />
  </svg>
);

// A tab under an icon on phones; an icon and its name in a 42px row in the sidebar.
const TAB =
  "flex flex-1 flex-col items-center gap-1 py-2 text-xs lg:h-[42px] lg:flex-none lg:flex-row lg:gap-2.5 lg:rounded-xl lg:px-3 lg:py-0 lg:text-[15px]";

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
      className={`${TAB} ${props.current ? "font-semibold text-ink lg:bg-well" : "text-ink-muted lg:font-medium lg:text-ink-soft lg:hover:bg-well"}`}
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
      className={`${TAB} ${props.wideOnly === true ? "hidden lg:flex " : ""}cursor-not-allowed text-ink-muted opacity-40 lg:font-medium lg:text-ink-soft`}
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
  current: Current | null;
  firstName: string | null;
}) {
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-10 flex border-t border-hairline bg-page pb-[env(safe-area-inset-bottom)] lg:inset-y-0 lg:right-auto lg:w-50 lg:flex-col lg:gap-1 lg:border-t-0 lg:border-r lg:px-3.5 lg:py-[22px]"
    >
      {/* The web design's mark: a stroke and a green dot on ink, and the wordmark. */}
      <span className="hidden items-center gap-2.5 px-2 pb-[18px] text-[22px] leading-none font-bold tracking-[-0.03em] lg:flex">
        <span
          aria-hidden="true"
          className="flex size-[30px] items-center justify-center gap-[3px] rounded-[9px] bg-ink"
        >
          <span className="h-3.5 w-1 rounded-sm bg-page" />
          <span className="mb-2 size-1.5 self-end rounded-full bg-go" />
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
        aria-current={current === "profile" ? "page" : undefined}
        className={`mt-auto hidden items-center gap-2.5 rounded-[14px] p-2 text-ink-muted hover:bg-well lg:flex ${current === "profile" ? "bg-well" : ""}`}
      >
        {/* The design's profile row: an initial and the name (owner, 2026-10-26). */}
        {firstName === null ? (
          PROFILE
        ) : (
          <span
            aria-hidden="true"
            className="flex size-[34px] shrink-0 items-center justify-center rounded-full bg-(--distributed-systems-tint) text-[13px] font-bold text-(--distributed-systems-line)"
          >
            {firstName.charAt(0).toUpperCase()}
          </span>
        )}
        <span className="flex min-w-0 flex-col">
          {firstName === null ? null : (
            <span className="truncate text-sm font-semibold text-ink">
              {firstName}
            </span>
          )}
          <span className="text-xs">Profile and settings</span>
        </span>
      </Link>
    </nav>
  );
}
