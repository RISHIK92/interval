"use client";

import { useEffect } from "react";

// The picked path sits in the middle of the list's own scroll (owner, 2026-10-29). The
// link's #path-<id> anchor still brings it into view without script, at the top.
export function CenterPicked({ pathId }: { pathId: string }) {
  useEffect(() => {
    // After the router's own scroll to the anchor, which would leave it at the top.
    const frame = requestAnimationFrame(() => {
      document
        .getElementById(`path-${pathId}`)
        ?.scrollIntoView({ block: "center" });
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [pathId]);
  return null;
}
