"use client";

import { type ReactNode, useState } from "react";
import type { Chip } from "../server/chips";
import { player } from "./listen/player";

// ADR-0044: the "Also fits" explainer queues just that one and plays it. While it
// works the button stays focusable (aria-disabled), so a keyboard user keeps their
// place; the status line is always there, so a failure is announced and seen.
export function AlsoFitsListen(props: {
  explainerId: string;
  position: number;
  chip: Chip;
  className: string;
  children: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <div className="flex h-full flex-col gap-1">
      <button
        type="button"
        aria-disabled={busy}
        className={`${props.className} aria-disabled:opacity-50`}
        onClick={() => {
          if (busy) return;
          setBusy(true);
          setFailed(false);
          void player()
            .enqueueExplainer(props.explainerId, {
              position: props.position,
              chip: props.chip,
            })
            .then((queued) => {
              setFailed(!queued);
              setBusy(false);
            });
        }}
      >
        {props.children}
      </button>
      <p role="status" className="text-sm text-wrong">
        {failed ? "That explainer can't be played right now." : ""}
      </p>
    </div>
  );
}
