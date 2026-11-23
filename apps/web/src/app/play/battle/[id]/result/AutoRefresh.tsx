"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

// A results page still waiting on something (the battle to end, the AI review to be
// written) reloads its data now and then, so the player never has to.
export function AutoRefresh({ everyMs }: { everyMs: number }) {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => {
      router.refresh();
    }, everyMs);
    return () => {
      clearInterval(timer);
    };
  }, [everyMs, router]);
  return null;
}
