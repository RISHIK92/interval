"use client";

import { useEffect } from "react";

// LG matches Tailwind's lg breakpoint, where the picked path is a side pane.
const LG = "(min-width: 64rem)";

// Shows the picked path (owner, 2026-10-29). Wide: its card sits in the middle of the
// list's own scroll (the #path-<id> anchor alone, without script, leaves it at the
// top). Phone: the path is a sheet over the list, so focus moves into it and the page
// behind stops scrolling.
export function ShowPicked({
  pathId,
  paneId,
}: {
  pathId: string;
  paneId: string;
}) {
  useEffect(() => {
    if (window.matchMedia(LG).matches) {
      // After the router's own scroll to the anchor, which would leave it at the top.
      const frame = requestAnimationFrame(() => {
        document
          .getElementById(`path-${pathId}`)
          ?.scrollIntoView({ block: "center" });
      });
      return () => {
        cancelAnimationFrame(frame);
      };
    }
    document.getElementById(paneId)?.focus();
    const root = document.documentElement;
    const before = root.style.overflow;
    root.style.overflow = "hidden";
    return () => {
      root.style.overflow = before;
    };
  }, [pathId, paneId]);
  return null;
}
