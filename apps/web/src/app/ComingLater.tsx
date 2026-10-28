import Link from "next/link";
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

const PATH = icon(
  <>
    <circle cx="6" cy="6" r="2" />
    <circle cx="18" cy="18" r="2" />
    <path d="M8 6h7a3 3 0 0 1 0 6H9a3 3 0 0 0 0 6h7" />
  </>,
);
const REVIEW = icon(<path d="M8 4h11v13M5 7h11v13H5z" />);
const LATER = [
  {
    name: "Streak",
    icon: icon(
      <path d="M12 3c1 4 5 5 5 10a5 5 0 0 1-10 0c0-3 2-4 2-7 2 1 3 3 3 5" />,
    ),
  },
  {
    name: "Tonight’s battle",
    icon: icon(<path d="M13 3L5 14h6l-1 7 8-11h-6z" />),
  },
];

function Panel(props: {
  icon: ReactNode;
  name: string;
  detail: string;
  href?: string;
}) {
  const inner = (
    <div
      className={`flex items-center gap-3 ${props.href === undefined ? "opacity-50" : ""}`}
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-well text-ink-muted">
        {props.icon}
      </span>
      <span className="min-w-0">
        <span className="block font-semibold">{props.name}</span>
        <span className="block truncate text-sm text-ink-muted">
          {props.detail}
        </span>
      </span>
    </div>
  );
  return (
    <Card className="p-4">
      {props.href === undefined ? (
        inner
      ) : (
        <Link href={props.href} className="block">
          {inner}
        </Link>
      )}
    </Card>
  );
}

// The design's right-hand column on wide screens (ADR-0019). Your path (Week 10) and
// the review queue (Week 9) are live; streaks and battles arrive with later phases, so
// they show greyed, with nothing made up.
export function ComingLater(props: {
  path: { pathId: string; name: string } | null;
  due: number;
}) {
  return (
    <aside aria-label="At a glance" className="hidden flex-col gap-3 lg:flex">
      <Panel
        icon={PATH}
        name="Your path"
        // Null also for an active path with nothing next: no claim either way.
        detail={props.path === null ? "See the paths" : props.path.name}
        href={props.path === null ? "/paths" : `/paths/${props.path.pathId}`}
      />
      <Panel
        icon={REVIEW}
        name="Review queue"
        detail={
          props.due === 0
            ? "Nothing due"
            : `${String(props.due)} concept${props.due === 1 ? "" : "s"} due`
        }
        href="/library#review-queue"
      />
      {LATER.map((panel) => (
        <Panel
          key={panel.name}
          icon={panel.icon}
          name={panel.name}
          detail="Coming later"
        />
      ))}
    </aside>
  );
}
