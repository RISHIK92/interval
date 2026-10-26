"use client";

import { useEffect, useState } from "react";
import type { Chip } from "../server/chips";
import { feedbackAction } from "./feedback/actions";

const SHOWN_MS = 3000;

// Straight after Not interested only (owner, 2026-10-26): there is no list to undo
// it from later in Phase 1. It goes after 3 s (owner, 2026-10-26), and leaves the
// address too, so a refresh doesn't bring it back.
export function UndoNotInterested({
  itemId,
  chip,
}: {
  itemId: string;
  chip: Chip;
}) {
  const [shown, setShown] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => {
      setShown(false);
      const url = new URL(window.location.href);
      url.searchParams.delete("undo");
      window.history.replaceState(window.history.state, "", url);
    }, SHOWN_MS);
    return () => {
      clearTimeout(timer);
    };
  }, []);
  if (!shown) return null;
  return (
    <form action={feedbackAction} className="my-4">
      <input type="hidden" name="itemId" value={itemId} />
      <input type="hidden" name="chip" value={chip} />
      <p className="flex items-center justify-between rounded-2xl bg-well px-4 py-3">
        Hidden.{" "}
        <button
          type="submit"
          name="control"
          value="undo_not_interested"
          className="font-semibold text-select"
        >
          Undo
        </button>
      </p>
    </form>
  );
}
