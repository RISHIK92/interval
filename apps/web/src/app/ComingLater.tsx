import type { ReactNode } from "react";
import { Card } from "./ui/Card";

const icon = (path: ReactNode) => (
  <svg
    aria-hidden="true"
    viewBox="0 0 24 24"
    className="size-5"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {path}
  </svg>
);

const PANELS = [
  {
    name: "Streak",
    icon: icon(
      <path d="M12 3c1 4 5 5 5 10a5 5 0 0 1-10 0c0-3 2-4 2-7 2 1 3 3 3 5" />,
    ),
  },
  {
    name: "Your path",
    icon: icon(
      <>
        <circle cx="6" cy="6" r="2" />
        <circle cx="18" cy="18" r="2" />
        <path d="M8 6h7a3 3 0 0 1 0 6H9a3 3 0 0 0 0 6h7" />
      </>,
    ),
  },
  {
    name: "Review queue",
    icon: icon(<path d="M8 4h11v13M5 7h11v13H5z" />),
  },
  {
    name: "Tonight’s battle",
    icon: icon(<path d="M13 3L5 14h6l-1 7 8-11h-6z" />),
  },
];

// The design's right-hand column on wide screens (ADR-0019): streaks, paths, review
// and battles arrive with later phases, so they show greyed, with nothing made up.
export function ComingLater() {
  return (
    <aside aria-label="Coming later" className="hidden flex-col gap-3 lg:flex">
      {PANELS.map((panel) => (
        <Card key={panel.name} className="p-4">
          <div className="flex items-center gap-3 opacity-50">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-well text-ink-muted">
              {panel.icon}
            </span>
            <span>
              <span className="block font-semibold">{panel.name}</span>
              <span className="block text-sm text-ink-muted">Coming later</span>
            </span>
          </div>
        </Card>
      ))}
    </aside>
  );
}
