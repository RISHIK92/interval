import { useSyncExternalStore } from "react";

const noChanges = () => () => undefined;

// A ranked window's start in the player's own time zone: null on the server, whose zone
// would differ and break hydration, and the moment before the page is live.
export function useWindowTime(at: string): string | null {
  return useSyncExternalStore(
    noChanges,
    () =>
      new Date(at).toLocaleString(undefined, {
        weekday: "long",
        hour: "numeric",
        minute: "2-digit",
      }),
    () => null,
  );
}
