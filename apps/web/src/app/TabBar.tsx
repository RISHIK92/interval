import Link from "next/link";
import type { ReactNode } from "react";

// The design's five tabs (owner, 2026-10-26; ADR-0017, which would amend ADR-0006
// C-06). Home and Library work; Explore, Paths and Play arrive with their phases and
// show disabled until then. Profile is reached from the header (Q-P1-19).
type Current = "home" | "library";

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
  library: icon(
    <>
      <path d="M5 4v16M9 4v16" />
      <path d="M13 5l4 15" />
    </>,
  ),
};

const TAB = "flex flex-1 flex-col items-center gap-1 py-2 text-xs";

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
      className={`${TAB} ${props.current ? "font-semibold text-ink" : "text-ink-muted"}`}
    >
      {props.icon}
      {props.name}
    </Link>
  );
}

function Later(props: { name: string; icon: ReactNode }) {
  return (
    <span
      aria-disabled="true"
      className={`${TAB} cursor-not-allowed text-ink-muted opacity-40`}
    >
      {props.icon}
      {props.name}
      <span className="sr-only">Coming later</span>
    </span>
  );
}

export function TabBar({ current }: { current: Current }) {
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-10 flex border-t border-hairline bg-page pb-[env(safe-area-inset-bottom)]"
    >
      <Live
        href="/"
        name="Home"
        current={current === "home"}
        icon={ICONS.home}
      />
      <Later name="Explore" icon={ICONS.explore} />
      <Later name="Paths" icon={ICONS.paths} />
      <Later name="Play" icon={ICONS.play} />
      <Live
        href="/library"
        name="Library"
        current={current === "library"}
        icon={ICONS.library}
      />
    </nav>
  );
}
