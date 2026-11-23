import type { ReactNode } from "react";

// A card lifts softly off the page (design system); in dark mode the shadow is gone, the
// card's surface sits a step above the page and the hairline carries the edge. Nothing
// is clipped: a card's "…" menu opens past its edge.
export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-3xl border border-hairline bg-card shadow-card ${className}`}
    >
      {children}
    </div>
  );
}
