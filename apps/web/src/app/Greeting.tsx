"use client";

import { useSyncExternalStore } from "react";
import type { Chip } from "../server/chips";
import { greeting } from "./greetings";

const noChanges = () => () => undefined;

// The part of day is the reader's, so the line is picked on the device; the server
// sends a plain hello (ADR-0019).
export function Greeting({
  firstName,
  chip,
  continuing,
}: {
  firstName: string | null;
  chip: Chip;
  continuing: string | null;
}) {
  const line = useSyncExternalStore(
    noChanges,
    () => {
      const now = new Date();
      const day = `${String(now.getFullYear())}-${String(now.getMonth() + 1)}-${String(now.getDate())}`;
      return greeting(
        {
          hour: now.getHours(),
          weekday: now.getDay(),
          firstName,
          chip,
          continuing,
        },
        day,
      );
    },
    () => (firstName === null ? "Hey there." : `Hey, ${firstName}.`),
  );
  return <h1 className="text-display">{line}</h1>;
}
