"use client";

import { type ReactNode, useState } from "react";
import { player } from "./player";

// P4-W23-S01 (owner, 2026-11-10): the reader's Listen queues the AI explainers of the
// article (ADR-0058) and plays the first; only rendered when one is voiced.
export function ListenButton(props: {
  itemId: string;
  className: string;
  children: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-label="Listen to the AI explainers"
        title="Listen"
        disabled={busy}
        className={`${props.className} disabled:opacity-50`}
        onClick={() => {
          setBusy(true);
          void player()
            .enqueue(props.itemId)
            .then((queued) => {
              setFailed(!queued);
              setBusy(false);
            });
        }}
      >
        {props.children}
      </button>
      {failed && (
        <span role="status" className="sr-only">
          Nothing to listen to here right now.
        </span>
      )}
    </>
  );
}
