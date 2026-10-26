import type { ReactNode } from "react";

// A card lifts softly off the page (design system); in dark mode the shadow is gone and
// the hairline carries the edge.
export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`overflow-hidden rounded-3xl border border-hairline bg-page shadow-card ${className}`}
    >
      {children}
    </div>
  );
}
