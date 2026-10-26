import type { ReactNode } from "react";

// AI-1: AI text always sits in a dashed box with a tag (design system, 2026-10-26).
export function AiBox({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-hairline px-3 py-2 text-ink">
      {children}{" "}
      <span className="ml-1 rounded-md bg-well px-1.5 py-0.5 text-xs font-semibold text-ink-muted">
        AI
      </span>
    </div>
  );
}
